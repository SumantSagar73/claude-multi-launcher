'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

// Wrapper around winhelper.ps1. The launcher writes the desired state to a JSON file; the helper applies it and
// reports back on stdout. The script is copied out of the app bundle first because PowerShell cannot read app.asar.
class WindowHelper extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.script = path.join(dir, 'winhelper.ps1');
    this.stateFile = path.join(dir, 'windowstate.json');
    this.child = null;
    this.state = { windows: [], trim: null };
    this.lastWritten = '';
  }

  get running() {
    return !!this.child;
  }

  start() {
    if (this.child) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const template = fs.readFileSync(path.join(__dirname, 'winhelper.ps1'), 'utf8');
    // split/join replaces every occurrence and, unlike String.replace, treats the text literally.
    const script = template
      .split('__STATE__')
      .join(this.stateFile.replace(/'/g, "''"))
      .split('__PARENT__')
      .join(String(process.pid));
    if (/__STATE__|__PARENT__/.test(script)) throw new Error('winhelper.ps1 has an unfilled placeholder');
    fs.writeFileSync(this.script, script);
    this.writeState(true);
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.fg !== undefined) this.emit('foreground', msg.fg);
        if (msg.trimmed) this.emit('trimmed', msg.trimmed);
        if (msg.styled) this.emit('styled', msg.styled);
        if (msg.tiled) this.emit('tiled', msg.tiled);
        if (msg.error) this.emit('error-text', msg.error);
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

  setWindows(windows) {
    this.state.windows = windows;
    this.writeState();
  }

  requestTrim(nonce, pids) {
    this.state.trim = { nonce, pids };
    this.writeState(true);
  }

  // windows: [{ pid, x, y, width, height }]
  requestLayout(nonce, windows) {
    this.state.layout = { nonce, windows };
    this.writeState(true);
  }

  writeState(force) {
    const text = JSON.stringify(this.state);
    if (!force && text === this.lastWritten) return;
    this.lastWritten = text;
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.stateFile}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, this.stateFile);
  }
}

module.exports = { WindowHelper };
