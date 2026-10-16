'use strict';
// Builds the downloadable files for the system it runs on into release/.
// On Windows:
//   Claude-Multi-Launcher-<version>.exe  one-click per-user installer (no admin rights)
//   Claude-Multi-Launcher-<version>.zip  portable copy: unzip anywhere and run
// On Linux:
//   Claude-Multi-Launcher-<version>-linux-x64.AppImage / .deb / .tar.gz
// The app is packaged into stage/ first (never dist/, which a running launcher may be using), then wrapped by
// electron-builder with --prepackaged so the icon embedded by electron-packager is kept.
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const bin = (name) => path.join(root, 'node_modules', '.bin', IS_WIN ? `${name}.cmd` : name);
const PLATFORM = IS_WIN ? 'win32' : 'linux';
const APP_DIR = `Claude Multi Launcher-${PLATFORM}-x64`;

function run(cmd, args) {
  console.log(`\n> ${path.basename(cmd)} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`\nFailed: ${path.basename(cmd)} exited with ${r.status}`);
    process.exit(r.status || 1);
  }
}

fs.rmSync(path.join(root, 'stage'), { recursive: true, force: true });
fs.rmSync(path.join(root, 'release'), { recursive: true, force: true });

run('node', ['scripts/make-icon.js']);
run(bin('electron-packager'), [
  '.', '"Claude Multi Launcher"', `--platform=${PLATFORM}`, '--arch=x64', '--out=stage', '--overwrite',
  ...(IS_WIN ? ['--icon=build/icon.ico'] : []),
  '--ignore="^/(dist|release|stage|test|scripts|build|spike-profile-a|.claude)($|/)"',
  '--ignore="^/README.md$"',
]);
run(bin('electron-builder'), ['--prepackaged', `"stage/${APP_DIR}"`, IS_WIN ? '--win' : '--linux', '--x64', '--publish', 'never']);

// stage/ is only an intermediate copy (about 370 MB); the installer and zip contain everything.
fs.rmSync(path.join(root, 'stage'), { recursive: true, force: true });

console.log('\nFiles in release/:');
for (const f of fs.readdirSync(path.join(root, 'release'))) {
  const p = path.join(root, 'release', f);
  if (!fs.statSync(p).isFile() || !/\.(exe|zip|AppImage|deb|tar\.gz)$/.test(f)) continue;
  const sha = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  console.log(`  ${f}  ${(fs.statSync(p).size / 1048576).toFixed(0)} MB  sha256 ${sha}`);
}
