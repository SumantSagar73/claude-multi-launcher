'use strict';

const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { sessionType } = require('./claude-linux');

const FOCUS_POLL_MS = 1000;

function xdotool(args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile('xdotool', args, { timeout }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

// What can be done to other programs' windows depends on the display server. Wayland deliberately gives a program no way
// to move or inspect another program's windows, so on Wayland these are off rather than half working. Freeing memory
// (Windows trims the working set) has no safe equivalent without special privileges, so it is off everywhere here.
async function probeCapabilities() {
  const x11 = sessionType() === 'x11' && !!process.env.DISPLAY;
  const haveTool = x11 && (await xdotool(['version'])) !== null;
  return { trim: false, tile: haveTool, focus: haveTool, style: false, reason: x11 ? (haveTool ? '' : 'xdotool is not installed') : 'needs an X11 session (Wayland does not allow it)' };
}

// Same surface as the Windows WindowHelper (winhelper.js), without PowerShell. It watches which window is in front so
// the launcher knows which account is in use, and tiles windows. Both need xdotool on an X11 session.
class WindowHelper extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.windows = [];
    this.caps = null;
    this.lastFg = null;
  }

  static probe() {
    return probeCapabilities();
  }

  get running() {
    return !!this.timer;
  }

  async start() {
    if (this.timer) return;
    this.caps = this.caps || (await probeCapabilities());
    if (this.timer || !this.caps.focus) return;
    this.timer = setInterval(() => this.pollForeground(), FOCUS_POLL_MS);
    this.timer.unref?.();
  }

  async pollForeground() {
    const out = await xdotool(['getactivewindow', 'getwindowpid']);
    const pid = out && /^\d+$/.test(out) ? Number(out) : 0;
    if (pid !== this.lastFg) {
      this.lastFg = pid;
      this.emit('foreground', pid);
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  setWindows(windows) {
    this.windows = windows;
  }

  requestTrim() {
    this.emit('error-text', 'Freeing memory is not available on Linux.');
  }

  // windows: [{ pid, x, y, width, height }]
  async requestLayout(_nonce, windows) {
    this.caps = this.caps || (await probeCapabilities());
    if (!this.caps.tile) {
      this.emit('error-text', `Tiling is not available: ${this.caps.reason}.`);
      return;
    }
    let moved = 0;
    for (const w of windows) {
      const ids = ((await xdotool(['search', '--onlyvisible', '--pid', String(w.pid)])) || '').split('\n').filter(Boolean);
      for (const id of ids) {
        // Helper windows (tooltips, menus) are small; only the account's real window is resized.
        const geo = (await xdotool(['getwindowgeometry', '--shell', id])) || '';
        const width = Number((/WIDTH=(\d+)/.exec(geo) || [])[1] || 0);
        const height = Number((/HEIGHT=(\d+)/.exec(geo) || [])[1] || 0);
        if (width < 300 || height < 200) continue;
        await xdotool(['windowsize', id, String(w.width), String(w.height)]);
        await xdotool(['windowmove', id, String(w.x), String(w.y)]);
        moved += 1;
        break;
      }
    }
    this.emit('tiled', { moved });
  }
}

module.exports = { WindowHelper, probeCapabilities };
