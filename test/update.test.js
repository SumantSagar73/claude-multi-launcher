'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseAptPolicy } = require('../src/claude-linux');
const { backupProfiles, pruneBackups, skip } = require('../src/backup');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cml-upd-'));

test('parseAptPolicy reads installed and candidate versions', () => {
  const text = 'claude-desktop:\n  Installed: 2.42304.0\n  Candidate: 3.1623.0\n  Version table:\n     3.1623.0 500\n';
  assert.deepEqual(parseAptPolicy(text), { installed: '2.42304.0', candidate: '3.1623.0', available: true });
  assert.equal(parseAptPolicy('claude-desktop:\n  Installed: 3.1\n  Candidate: 3.1\n').available, false);
});

test('parseAptPolicy gives null when the package is not installed or unknown', () => {
  assert.equal(parseAptPolicy('claude-desktop:\n  Installed: (none)\n  Candidate: 3.1\n'), null);
  assert.equal(parseAptPolicy(''), null);
  assert.equal(parseAptPolicy('N: Unable to locate package claude-desktop'), null);
});

test('backup skips the big re-creatable parts and keeps the sign-in data', () => {
  assert.ok(skip('vm_bundles') && skip('Code Cache') && skip('GPUCache') && skip('claude-code') && skip('SingletonLock'));
  assert.ok(!skip('Cookies') && !skip('Local Storage') && !skip('claude_desktop_config.json'));

  const root = tmp();
  const profile = path.join(root, 'profiles', 'abc');
  fs.mkdirSync(path.join(profile, 'Local Storage'), { recursive: true });
  fs.mkdirSync(path.join(profile, 'vm_bundles'), { recursive: true });
  fs.mkdirSync(path.join(profile, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'Cookies'), 'c');
  fs.writeFileSync(path.join(profile, 'Local Storage', 'x'), 'l');
  fs.writeFileSync(path.join(profile, 'vm_bundles', 'big.img'), 'v');
  fs.writeFileSync(path.join(profile, 'Cache', 'junk'), 'j');

  const dest = path.join(root, 'backups');
  const { dest: made, count } = backupProfiles([{ id: 'abc', dataDir: profile }, { id: 'gone', dataDir: path.join(root, 'missing') }], dest);
  assert.equal(count, 1);
  assert.ok(fs.existsSync(path.join(made, 'abc', 'Cookies')));
  assert.ok(fs.existsSync(path.join(made, 'abc', 'Local Storage', 'x')));
  assert.ok(!fs.existsSync(path.join(made, 'abc', 'vm_bundles')));
  assert.ok(!fs.existsSync(path.join(made, 'abc', 'Cache')));
  assert.equal(fs.readFileSync(path.join(profile, 'Cookies'), 'utf8'), 'c'); // the original is untouched
});

test('pruneBackups keeps only the newest ones', () => {
  const dest = tmp();
  for (const n of ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']) fs.mkdirSync(path.join(dest, n));
  assert.deepEqual(pruneBackups(dest, 2), ['2026-01-01', '2026-02-01']);
  assert.deepEqual(fs.readdirSync(dest).sort(), ['2026-03-01', '2026-04-01']);
  assert.deepEqual(pruneBackups(path.join(dest, 'nope'), 2), []);
});
