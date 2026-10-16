'use strict';

// Freedesktop .desktop files: the Linux equivalent of a Start Menu shortcut and of "start with Windows". Pure
// functions here so the quoting rules can be tested anywhere; writing the files is in the last function.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Exec= values follow the desktop-entry spec: an argument with spaces or special characters is double-quoted, and
// inside quotes " ` $ \ are backslash-escaped. A literal % must be written %% because %f, %u etc. are field codes.
function execArg(arg) {
  const s = String(arg).replace(/%/g, '%%');
  if (!/[\s"'`$\\<>~|&;*?#()]/.test(s)) return s;
  return `"${s.replace(/(["`$\\])/g, '\\$1')}"`;
}

const execLine = (args) => args.map(execArg).join(' ');

// Values other than Exec only need newlines removed.
const plain = (s) => String(s).replace(/[\r\n]+/g, ' ');

function buildDesktopEntry({ name, comment, exec, icon, wmClass, extra = {} }) {
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${plain(name)}`,
    comment ? `Comment=${plain(comment)}` : null,
    `Exec=${execLine(exec)}`,
    icon ? `Icon=${plain(icon)}` : null,
    'Terminal=false',
    'Categories=Network;Utility;',
    wmClass ? `StartupWMClass=${plain(wmClass)}` : null,
    ...Object.entries(extra).map(([k, v]) => `${k}=${plain(v)}`),
  ];
  return lines.filter((l) => l !== null).join('\n') + '\n';
}

const configHome = () => process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const dataHome = () => process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');

const applicationsDir = () => path.join(dataHome(), 'applications');
const autostartFile = () => path.join(configHome(), 'autostart', 'claude-multi-launcher.desktop');

// File names are made from the account id so renaming an account never leaves a stale entry behind.
const accountEntryFile = (profile) => path.join(applicationsDir(), `${accountEntryName(profile)}.desktop`);
const accountEntryName = (profile) => `claude-multi-${String(profile.id).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;

function writeEntry(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o644 });
  fs.renameSync(tmp, file);
}

function setAutostart(enabled, { exec, icon }) {
  const file = autostartFile();
  if (!enabled) {
    fs.rmSync(file, { force: true });
    return;
  }
  writeEntry(
    file,
    buildDesktopEntry({
      name: 'Claude Multi Launcher',
      comment: 'Several Claude Desktop accounts side by side',
      exec,
      icon,
      extra: { 'X-GNOME-Autostart-enabled': 'true' },
    }),
  );
}

const isAutostartOn = () => fs.existsSync(autostartFile());

module.exports = {
  execArg,
  execLine,
  buildDesktopEntry,
  accountEntryFile,
  accountEntryName,
  applicationsDir,
  autostartFile,
  setAutostart,
  isAutostartOn,
  writeEntry,
};
