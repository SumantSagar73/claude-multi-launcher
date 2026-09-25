'use strict';
// Builds the downloadable Windows files into release/:
//   Claude-Multi-Launcher-<version>.exe  one-click per-user installer (no admin rights)
//   Claude-Multi-Launcher-<version>.zip  portable copy: unzip anywhere and run
// The app is packaged into stage/ first (never dist/, which a running launcher may be using), then wrapped by
// electron-builder with --prepackaged so the icon embedded by electron-packager is kept.
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const bin = (name) => path.join(root, 'node_modules', '.bin', `${name}.cmd`);

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
  '.', '"Claude Multi Launcher"', '--platform=win32', '--arch=x64', '--out=stage', '--overwrite',
  '--icon=build/icon.ico',
  '--ignore="^/(dist|release|stage|test|scripts|build|spike-profile-a|.claude)($|/)"',
  '--ignore="^/README.md$"',
]);
run(bin('electron-builder'), ['--prepackaged', '"stage/Claude Multi Launcher-win32-x64"', '--win', '--x64', '--publish', 'never']);

// stage/ is only an intermediate copy (about 370 MB); the installer and zip contain everything.
fs.rmSync(path.join(root, 'stage'), { recursive: true, force: true });

console.log('\nFiles in release/:');
for (const f of fs.readdirSync(path.join(root, 'release'))) {
  const p = path.join(root, 'release', f);
  if (!fs.statSync(p).isFile() || !/\.(exe|zip)$/.test(f)) continue;
  const sha = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  console.log(`  ${f}  ${(fs.statSync(p).size / 1048576).toFixed(0)} MB  sha256 ${sha}`);
}
