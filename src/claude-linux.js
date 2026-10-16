'use strict';

// Linux side of claude.js: find the Claude Desktop binary, list its running instances from /proc, start and stop them.
// Everything that reads /proc takes the root as a parameter so the unit tests can point it at a fake tree.

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_CANDIDATES = [
  '/usr/bin/claude-desktop',
  '/opt/Claude/claude-desktop',
  '/opt/claude-desktop/claude-desktop',
  '/usr/lib/claude-desktop/claude-desktop',
];

// Community builds from the Snap Store. Anthropic's own package is preferred when both are installed.
const SNAP_APPS = ['claude-ai-desktop'];

function run(cmd, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function onPath(name, pathVar = process.env.PATH || '') {
  for (const dir of pathVar.split(':')) {
    if (!dir) continue;
    const full = path.join(dir, name);
    if (isExecutable(full)) return full;
  }
  return null;
}

// A snap's command is a symlink to /usr/bin/snap, so the real program is found by its snap name instead.
// Returns the snap's name for /snap/bin/<name>, else null.
function snapNameOf(exe) {
  const m = /^\/snap\/bin\/([^/]+)$/.exec(exe);
  return m ? m[1] : null;
}

const snapHome = () => process.env.HOME || os.homedir();

function locateClaudeSync() {
  const override = process.env.CML_CLAUDE_PATH;
  if (override) return isExecutable(override) ? override : null;
  const official = onPath('claude-desktop') || DEFAULT_CANDIDATES.find(isExecutable);
  if (official) return official;
  for (const name of SNAP_APPS) {
    const f = `/snap/bin/${name}`;
    if (isExecutable(f)) return f;
  }
  return null;
}

// Where a snap may keep an account's data folder. Its sandbox allows its own ~/snap/<name>/ folders and ordinary
// (non-hidden) folders in the home directory, but not hidden ones such as ~/.config, where the launcher's accounts live
// for other installs. ~/snap/<name>/common is kept across snap updates, so accounts go there.
function snapPaths(name, home = snapHome()) {
  return {
    profilesRoot: path.join(home, 'snap', name, 'common', 'multi-launcher', 'profiles'),
    defaultDataDir: path.join(home, 'snap', name, 'current', '.config', 'claude-desktop'),
  };
}

// Synchronous hints for start-up, before the (asynchronous) full lookup has run: where this kind of install keeps its
// default account and where new accounts must be stored.
function dataHints() {
  const exe = locateClaudeSync();
  const name = exe && snapNameOf(exe);
  return name ? snapPaths(name) : {};
}

// null if a snap can use this account folder, otherwise a sentence saying what is wrong.
function snapDataDirProblem(dataDir, name, home = snapHome()) {
  const rel = path.relative(home, dataDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null; // outside the home folder: the snap's own rules decide
  if (rel.startsWith(path.join('snap', name) + path.sep)) return null;
  if (rel.split(path.sep).some((part) => part.startsWith('.'))) {
    return `${name} is a snap and cannot write to hidden folders such as ${dataDir}. Remove this account and add it again; new accounts are stored under ~/snap/${name}/common.`;
  }
  return null;
}

// Where is the Claude Desktop executable? CML_CLAUDE_PATH wins (also the escape hatch for unusual installs), then PATH,
// then the places the .deb package is known to use, then a community snap, then whatever `dpkg -L claude-desktop` lists.
async function locateClaude() {
  const override = process.env.CML_CLAUDE_PATH;
  if (override) {
    if (!isExecutable(override)) throw new Error(`CML_CLAUDE_PATH is set to ${override}, but that is not an executable file.`);
    return override;
  }
  const found = locateClaudeSync();
  if (found) return found;
  const listed = (await run('dpkg', ['-L', 'claude-desktop']))
    .split('\n')
    .filter((l) => /\/claude-desktop$/.test(l) && isExecutable(l));
  if (listed[0]) return listed[0];
  throw new Error(
    'Claude Desktop is not installed. Install it with "sudo apt install claude-desktop" (see the README) or from the Snap Store (claude-ai-desktop), or set CML_CLAUDE_PATH to its executable.',
  );
}

// The command a user runs may be a small shell wrapper that execs the real binary. /proc/<pid>/exe shows the real one,
// so collect both: the file itself and any absolute path it `exec`s.
function realExecutables(exe) {
  const set = new Set();
  const add = (p) => {
    try {
      set.add(fs.realpathSync(p));
    } catch {
      // not there; skip
    }
  };
  add(exe);
  try {
    const head = fs.readFileSync(exe, { encoding: 'utf8', flag: 'r' }).slice(0, 4096);
    if (head.startsWith('#!')) {
      for (const m of head.matchAll(/\bexec\s+(?:-a\s+\S+\s+)?["']?(\/[^\s"'$]+)/g)) add(m[1]);
    }
  } catch {
    // binary file or unreadable: nothing more to learn
  }
  return set;
}

let cache = { at: 0, value: null };

async function findClaude() {
  if (cache.value && Date.now() - cache.at < 60_000) return cache.value;
  const exe = await locateClaude();
  const snap = snapNameOf(exe);
  if (snap) {
    // Processes of a snap run from /snap/<name>/<revision>/, which changes on every update, so match on the folder.
    const version = (await run('snap', ['list', snap])).split('\n')[1]?.split(/\s+/)[1] || 'unknown';
    cache = { at: Date.now(), value: { exe, version, snap, reals: new Set(), names: new Set([snap, 'desktop-for-claude.bin']) } };
    return cache.value;
  }
  const version = (await run('dpkg-query', ['-W', '-f=${Version}', 'claude-desktop'])).trim() || 'unknown';
  const reals = realExecutables(exe);
  const names = new Set([path.basename(exe), ...[...reals].map((r) => path.basename(r))]);
  cache = { at: Date.now(), value: { exe, version, snap: null, reals, names } };
  return cache.value;
}

// Sync view of what findClaude learned, for code that runs on a timer (the link watcher).
function knownNames() {
  return cache.value ? cache.value.names : new Set(['claude-desktop']);
}

// Reads --user-data-dir from an argv array. Chromium accepts both "--user-data-dir=/x" and "--user-data-dir /x".
function parseUserDataDirArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--user-data-dir=')) return a.slice('--user-data-dir='.length) || null;
    if (a === '--user-data-dir' && i + 1 < argv.length) return argv[i + 1];
  }
  return null;
}

// When did this process start? /proc/<pid>/stat counts clock ticks since boot (field 22; the command name in field 2 may
// contain spaces, so count from the closing bracket) and /proc/stat gives the boot time. Null if anything is unreadable.
function startTimeMs(procRoot, pid) {
  try {
    const stat = fs.readFileSync(path.join(procRoot, String(pid), 'stat'), 'utf8');
    const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
    const btime = Number(/^btime\s+(\d+)/m.exec(fs.readFileSync(path.join(procRoot, 'stat'), 'utf8'))[1]);
    return Number.isFinite(ticks) && Number.isFinite(btime) ? btime * 1000 + (ticks / 100) * 1000 : null;
  } catch {
    return null;
  }
}

function readProc(procRoot, pid) {
  const dir = path.join(procRoot, String(pid));
  let status;
  let cmdline;
  try {
    status = fs.readFileSync(path.join(dir, 'status'), 'utf8');
    cmdline = fs.readFileSync(path.join(dir, 'cmdline'), 'utf8');
  } catch {
    return null; // the process exited while we were looking
  }
  let exe = null;
  try {
    exe = fs.readlinkSync(path.join(dir, 'exe')).replace(/ \(deleted\)$/, '');
  } catch {
    // another user's process, or a kernel thread
  }
  const num = (key) => {
    const m = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(status);
    return m ? Number(m[1]) : 0;
  };
  return {
    pid,
    startMs: startTimeMs(procRoot, pid),
    ppid: num('PPid'),
    rssBytes: num('VmRSS') * 1024,
    exe,
    argv: splitCmdline(cmdline),
  };
}

// /proc/<pid>/cmdline is NUL-separated. Chromium's child processes (renderer, GPU, zygote) rewrite their own title, which
// leaves the whole command as ONE space-separated string, so that form is split on spaces too. (Paths with spaces
// break in that form, but children are only checked for their --type= flag.)
function splitCmdline(raw) {
  const parts = raw.split('\0').filter((a, i, all) => a !== '' || i < all.length - 1);
  return parts.length === 1 && / --?\w/.test(parts[0]) ? parts[0].split(' ').filter(Boolean) : parts;
}

// Proportional set size counts memory shared between Claude's own processes once instead of once per process, which is
// what an account really costs. Falls back to RSS if the kernel will not show it.
function pssBytes(procRoot, pid) {
  try {
    const m = /^Pss:\s+(\d+)\s+kB/m.exec(fs.readFileSync(path.join(procRoot, String(pid), 'smaps_rollup'), 'utf8'));
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

function listPids(procRoot) {
  try {
    return fs.readdirSync(procRoot).filter((n) => /^\d+$/.test(n)).map(Number);
  } catch {
    return [];
  }
}

function isClaudeProcess(p, claude) {
  // Fall back to the first word of the command line where the exe link cannot be read (a confined process).
  const exe = p.exe || p.argv[0] || null;
  if (!exe) return false;
  if (claude.snap) return exe.startsWith(`/snap/${claude.snap}/`);
  if (claude.reals.has(exe)) return true;
  // The exe link can point at a different file after an update replaced it while Claude was running.
  return claude.names.has(path.basename(exe));
}

/**
 * Running Claude Desktop instances, one per main process (a Claude process without --type=).
 * Returns [{ pid, dataDir|null, pids (whole process tree), memBytes }], the same shape as the Windows scan.
 */
async function scanInstances({ procRoot = '/proc', claude } = {}) {
  const info = claude || (await findClaude());
  const procs = [];
  for (const pid of listPids(procRoot)) {
    const p = readProc(procRoot, pid);
    if (p && isClaudeProcess(p, info)) procs.push(p);
  }

  const children = new Map();
  for (const p of procs) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p);
  }
  const treeOf = (p, seen = new Set()) => {
    if (seen.has(p.pid)) return [];
    seen.add(p.pid);
    return [p, ...(children.get(p.pid) || []).flatMap((c) => treeOf(c, seen))];
  };

  return procs
    .filter((p) => !p.argv.some((a) => a.startsWith('--type=')))
    .map((p) => {
      const tree = treeOf(p);
      return {
        pid: p.pid,
        startedAt: p.startMs,
        dataDir: parseUserDataDirArgs(p.argv),
        pids: tree.map((t) => t.pid),
        memBytes: tree.reduce((sum, t) => sum + (pssBytes(procRoot, t.pid) ?? t.rssBytes), 0),
      };
    });
}

// Launching again with the same --user-data-dir hands the request (and any URL) to the running instance.
// --class gives every account its own window class, so a task bar can group an account's windows and the .desktop file
// made by the shortcut button can match them.
async function launchProfile(profile, url) {
  const { exe, snap } = await findClaude();
  if (snap && !profile.isDefault) {
    const problem = snapDataDirProblem(profile.dataDir, snap);
    if (problem) throw new Error(problem);
  }
  const args = [];
  if (!profile.isDefault) args.push(`--user-data-dir=${profile.dataDir}`, `--class=${wmClassFor(profile)}`);
  if (url) args.push(url);
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

const wmClassFor = (profile) => `claude-multi-${String(profile.id).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SIGTERM is a normal quit for an Electron app. If it is still there after a few seconds (Claude may only hide its
// window), force the whole tree down.
async function quitInstance(pid, opts = {}) {
  const inst = (await scanInstances(opts)).find((i) => i.pid === pid);
  const tree = inst ? inst.pids : [pid];
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  for (let i = 0; i < 12 && alive(pid); i++) await sleep(250);
  if (!alive(pid)) return;
  for (const p of tree) {
    try {
      process.kill(p, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

const sessionType = () => process.env.XDG_SESSION_TYPE || (process.env.WAYLAND_DISPLAY ? 'wayland' : process.env.DISPLAY ? 'x11' : 'unknown');

module.exports = {
  findClaude,
  knownNames,
  scanInstances,
  launchProfile,
  quitInstance,
  parseUserDataDirArgs,
  dataHints,
  snapNameOf,
  snapPaths,
  snapDataDirProblem,
  isClaudeProcess,
  wmClassFor,
  listPids,
  readProc,
  splitCmdline,
  sessionType,
  osRelease: () => os.release(),
};
