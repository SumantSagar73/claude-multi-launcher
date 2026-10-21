'use strict';

// A safety copy of the launcher accounts' sign-in data, made before Claude Desktop is updated. The big, re-creatable parts
// (Cowork VM images, caches, the downloaded Claude Code binary) are left out so it stays small. Only the launcher's own
// accounts are copied; the Default Claude is never read or copied here.

const fs = require('node:fs');
const path = require('node:path');

const SKIP_NAMES = new Set(['vm_bundles', 'claude-code', 'Crashpad']);
const skip = (name) => SKIP_NAMES.has(name) || /cache$/i.test(name) || name.startsWith('Singleton');

function backupProfiles(profiles, destRoot, now = new Date()) {
  const dest = path.join(destRoot, now.toISOString().replace(/[:.]/g, '-'));
  let count = 0;
  for (const p of profiles) {
    if (!fs.existsSync(p.dataDir)) continue;
    fs.cpSync(p.dataDir, path.join(dest, String(p.id).replace(/[^a-z0-9-]/gi, '')), {
      recursive: true,
      filter: (src) => !skip(path.basename(src)),
    });
    count += 1;
  }
  return { dest, count };
}

// Keeps only the newest `keep` backups.
function pruneBackups(destRoot, keep = 2) {
  let names;
  try {
    names = fs.readdirSync(destRoot).sort();
  } catch {
    return [];
  }
  const old = names.slice(0, Math.max(0, names.length - keep));
  for (const n of old) fs.rmSync(path.join(destRoot, n), { recursive: true, force: true });
  return old;
}

module.exports = { backupProfiles, pruneBackups, skip };
