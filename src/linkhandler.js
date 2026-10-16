'use strict';

// Linux: make this launcher the program the system hands claude:// links to. A browser sign-in ends with such a link;
// Claude Desktop's own entry would open it in the Default account. With the launcher in between, the link always goes
// through the same routing decision (router.js), however long ago the account was opened, and without watching
// /proc. Reversible: the entry that was the handler before is remembered and put back.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const desktop = require('./desktopentry');

const MIME = 'x-scheme-handler/claude';
const ENTRY = 'claude-multi-launcher-links.desktop';

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => resolve({ ok: !err, out: err ? '' : String(stdout).trim() }));
  });
}

const dataDirs = () => [
  desktop.applicationsDir(),
  ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean).map((d) => path.join(d, 'applications')),
];

// Desktop entries (other than ours) that say they open claude:// links, e.g. Claude Desktop's own.
function findHandlerEntries(dirs = dataDirs()) {
  const found = [];
  for (const dir of dirs) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith('.desktop') || n === ENTRY || found.includes(n)) continue;
      try {
        if (new RegExp(`^MimeType=.*${MIME}`, 'm').test(fs.readFileSync(path.join(dir, n), 'utf8'))) found.push(n);
      } catch {
        // unreadable entry: skip
      }
    }
  }
  return found;
}

const available = async () => (await run('xdg-mime', ['--version'])).ok;
const current = async () => (await run('xdg-mime', ['query', 'default', MIME])).out;
const isOn = async () => (await current()) === ENTRY;

async function enable({ exec, icon, stateFile }) {
  const prev = await current();
  if (prev && prev !== ENTRY) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, prev);
  }
  desktop.writeEntry(
    path.join(desktop.applicationsDir(), ENTRY),
    desktop.buildDesktopEntry({
      name: 'Claude Multi Launcher (sign-in links)',
      comment: 'Sends claude:// sign-in links to the account that started the sign-in',
      exec,
      fieldCode: '%u',
      icon,
      extra: { MimeType: `${MIME};`, NoDisplay: 'true' },
    }),
  );
  await run('update-desktop-database', [desktop.applicationsDir()]);
  const set = await run('xdg-mime', ['default', ENTRY, MIME]);
  if (!set.ok || (await current()) !== ENTRY) throw new Error('The system did not accept the change (xdg-mime default failed).');
}

async function disable({ stateFile }) {
  let prev = '';
  try {
    prev = fs.readFileSync(stateFile, 'utf8').trim();
  } catch {
    // never recorded
  }
  if (!prev || prev === ENTRY) prev = findHandlerEntries()[0] || '';
  if (prev) await run('xdg-mime', ['default', prev, MIME]);
  fs.rmSync(path.join(desktop.applicationsDir(), ENTRY), { force: true });
  await run('update-desktop-database', [desktop.applicationsDir()]);
  return prev;
}

module.exports = { MIME, ENTRY, findHandlerEntries, available, current, isOn, enable, disable, homeDir: os.homedir };
