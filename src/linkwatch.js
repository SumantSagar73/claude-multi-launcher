'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

// When a browser hands a claude:// link to Windows, Windows starts Claude.exe with that link on its command line
// (always the Default profile). Windows gives an ordinary user no event for new processes, so linkwatch.ps1 checks for
// them every 20 ms. It only runs while a sign-in is plausibly in progress. The script is copied out of the app bundle
// first because PowerShell cannot read app.asar.
class LinkWatcher extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.file = path.join(dir, 'linkwatch.ps1');
    this.child = null;
  }

  get running() {
    return !!this.child;
  }

  start() {
    if (this.child) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const template = fs.readFileSync(path.join(__dirname, 'linkwatch.ps1'), 'utf8');
    const script = template.split('__PARENT__').join(String(process.pid));
    if (script.includes('__PARENT__')) throw new Error('linkwatch.ps1 has an unfilled placeholder');
    fs.writeFileSync(this.file, script);

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.file],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.debug) this.emit('debug', msg.debug);
        else this.emit('process', { pid: msg.pid, commandLine: msg.cmd });
      } catch {
        // not one of ours
      }
    });
    let errText = '';
    child.stderr.on('data', (d) => {
      errText = (errText + d).slice(-2000);
    });
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      if (code && errText) this.emit('error-text', errText.trim());
    });
    child.on('error', () => {
      if (this.child === child) this.child = null;
    });
    this.child = child;
  }

  stop() {
    const child = this.child;
    this.child = null;
    if (child) child.kill();
  }
}

module.exports = { LinkWatcher };
