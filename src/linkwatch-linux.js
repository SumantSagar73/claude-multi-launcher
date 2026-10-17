'use strict';

const { EventEmitter } = require('node:events');
const path = require('node:path');
const { knownNames, listPids, readProc } = require('./claude-linux');

const POLL_MS = 25;

// Does this command line look like "Claude Desktop was just asked to open a claude:// link"? The first two words are
// checked because the command may be a shell wrapper (`/bin/sh /usr/bin/claude-desktop claude://...`) for a moment
// before it execs the real binary. xdg-open and browsers can carry the same link, but they are not Claude.
function isClaudeLinkLaunch(argv, names) {
  if (!argv.some((a, i) => i > 0 && /^claude:\/\//i.test(a))) return false;
  return argv.slice(0, 2).some((a) => names.has(path.basename(a)));
}

// Linux counterpart of linkwatch.ps1. When a browser finishes a sign-in, xdg-open starts the claude-desktop command
// with the link on its command line (always the Default profile). That process hands the link to the running Claude and
// exits within a fraction of a second, so /proc is checked every few milliseconds for new processes. Only new process
// ids are read, which keeps this cheap. It only runs while a sign-in is plausibly in progress.
class LinkWatcher extends EventEmitter {
  constructor(_dir, { procRoot = '/proc' } = {}) {
    super();
    this.procRoot = procRoot;
    this.timer = null;
    this.seen = new Set();
    this.pending = new Map(); // pid -> ticks it has looked empty
  }

  get running() {
    return !!this.timer;
  }

  start() {
    if (this.timer) return;
    this.seen = new Set(listPids(this.procRoot));
    this.pending.clear();
    this.timer = setInterval(() => this.tick(), POLL_MS);
    this.timer.unref?.();
  }

  tick() {
    try {
      const names = knownNames();
      const now = listPids(this.procRoot);
      const current = new Set(now);
      for (const pid of now) {
        if (this.seen.has(pid)) continue;
        const p = readProc(this.procRoot, pid);
        // A process that is still between fork and exec has an empty command line; look again for a few ticks. Kernel
        // threads stay empty forever, so give up on them quickly instead of reading them 40 times a second.
        if (!p) continue;
        if (p.argv.length === 0) {
          const n = (this.pending.get(pid) || 0) + 1;
          if (n < 4) {
            this.pending.set(pid, n);
            continue;
          }
        }
        this.pending.delete(pid);
        this.seen.add(pid);
        if (isClaudeLinkLaunch(p.argv, names)) this.emit('process', { pid, commandLine: p.argv.join(' ') });
      }
      for (const pid of this.seen) if (!current.has(pid)) this.seen.delete(pid);
      for (const pid of this.pending.keys()) if (!current.has(pid)) this.pending.delete(pid);
    } catch (e) {
      this.emit('error-text', String(e && e.message ? e.message : e));
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { LinkWatcher, isClaudeLinkLaunch };
