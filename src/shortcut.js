'use strict';

const { execFile } = require('node:child_process');

// Creates a .lnk via the same WScript.Shell COM approach scripts/install.ps1 already uses. One-off process, not a
// persistent helper.
function createShortcut({ linkPath, targetPath, args, workingDir, iconPath, description }) {
  const esc = (s) => String(s).replace(/'/g, "''");
  const script = [
    "$sc = (New-Object -ComObject WScript.Shell).CreateShortcut('" + esc(linkPath) + "')",
    "$sc.TargetPath = '" + esc(targetPath) + "'",
    args ? "$sc.Arguments = '" + esc(args) + "'" : null,
    "$sc.WorkingDirectory = '" + esc(workingDir) + "'",
    iconPath ? "$sc.IconLocation = '" + esc(iconPath) + ",0'" : null,
    description ? "$sc.Description = '" + esc(description) + "'" : null,
    '$sc.Save()',
  ]
    .filter(Boolean)
    .join('; ');

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (err, _out, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve();
    });
  });
}

module.exports = { createShortcut };
