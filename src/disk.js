'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// Size of a folder in bytes. Missing folders count as 0; unreadable entries are skipped.
async function folderSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  const sizes = await Promise.all(
    entries.map(async (e) => {
      const full = path.join(dir, e.name);
      try {
        if (e.isDirectory()) return await folderSize(full);
        if (e.isFile()) return (await fs.stat(full)).size;
      } catch {
        // file vanished or is locked; ignore
      }
      return 0;
    }),
  );
  for (const n of sizes) total += n;
  return total;
}

module.exports = { folderSize };
