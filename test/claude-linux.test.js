'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const linux = require('../src/claude-linux');
const { LinkWatcher, isClaudeLinkLaunch } = require('../src/linkwatch-linux');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cml-linux-'));

// Builds a fake /proc with the files the launcher reads.
function fakeProc(root, procs) {
  for (const p of procs) {
    const dir = path.join(root, String(p.pid));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'status'), `Name:\t${p.name || 'claude-desktop'}\nPPid:\t${p.ppid || 1}\nVmRSS:\t${p.rssKb || 1000} kB\n`);
    fs.writeFileSync(path.join(dir, 'cmdline'), p.argv.join('\0') + '\0');
    if (p.exe) fs.symlinkSync(p.exe, path.join(dir, 'exe'));
    if (p.pssKb) fs.writeFileSync(path.join(dir, 'smaps_rollup'), `Rss: 5 kB\nPss:\t${p.pssKb} kB\n`);
  }
}

const EXE = '/opt/Claude/claude-desktop';
const claude = { exe: '/usr/bin/claude-desktop', reals: new Set([EXE]), names: new Set(['claude-desktop']) };

test('parseUserDataDirArgs reads both Chromium spellings, including paths with spaces', () => {
  assert.equal(linux.parseUserDataDirArgs(['x', '--user-data-dir=/a b/c', 'claude://x']), '/a b/c');
  assert.equal(linux.parseUserDataDirArgs(['x', '--user-data-dir', '/a b/c']), '/a b/c');
  assert.equal(linux.parseUserDataDirArgs(['x', '--type=gpu-process']), null);
  assert.equal(linux.parseUserDataDirArgs(['x', '--user-data-dir']), null);
});

test('scanInstances finds one instance per main process, with its tree, data folder and memory', async () => {
  const root = tmp();
  fakeProc(root, [
    // Default account: no --user-data-dir
    { pid: 100, ppid: 1, argv: [EXE], exe: EXE, rssKb: 1000, pssKb: 800 },
    { pid: 101, ppid: 100, argv: [EXE, '--type=gpu-process'], exe: EXE, rssKb: 500, pssKb: 200 },
    // A second account, with a space in its folder and a grandchild process
    { pid: 200, ppid: 1, argv: [EXE, '--user-data-dir=/home/u/My Profiles/work', '--class=claude-multi-abc'], exe: EXE, rssKb: 2000 },
    { pid: 201, ppid: 200, argv: [EXE, '--type=zygote'], exe: EXE, rssKb: 100 },
    { pid: 202, ppid: 201, argv: [EXE, '--type=renderer'], exe: EXE, rssKb: 300 },
    // Not Claude: another Electron app and a shell
    { pid: 300, ppid: 1, argv: ['/usr/bin/code'], exe: '/usr/bin/code' },
    { pid: 301, ppid: 1, argv: ['bash'], exe: '/usr/bin/bash' },
  ]);
  const found = (await linux.scanInstances({ procRoot: root, claude })).sort((a, b) => a.pid - b.pid);
  assert.equal(found.length, 2);
  assert.deepEqual(found[0], { pid: 100, startedAt: null, dataDir: null, pids: [100, 101], memBytes: (800 + 200) * 1024 });
  assert.equal(found[1].dataDir, '/home/u/My Profiles/work');
  assert.deepEqual(found[1].pids.sort(), [200, 201, 202]);
  assert.equal(found[1].memBytes, (2000 + 100 + 300) * 1024); // no smaps_rollup: falls back to RSS
});

test('Chromium child processes that rewrite their title as one string are still recognised as children', async () => {
  const root = tmp();
  fakeProc(root, [
    { pid: 100, ppid: 1, argv: [EXE, '--user-data-dir=/home/u/p'], exe: EXE },
    // as seen on a real run: the whole command line is a single NUL-free, space-separated element
    { pid: 101, ppid: 100, argv: [`${EXE} --type=zygote --no-sandbox`], exe: EXE },
    { pid: 102, ppid: 101, argv: [`${EXE} --type=renderer --user-data-dir=/home/u/p --lang=en-US`], exe: EXE },
  ]);
  const found = await linux.scanInstances({ procRoot: root, claude });
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].pids.sort(), [100, 101, 102]);
  assert.deepEqual(linux.splitCmdline('/a/b --x=1 --y\0'), ['/a/b', '--x=1', '--y']);
  assert.deepEqual(linux.splitCmdline('/a/b\0--x=1 2\0'), ['/a/b', '--x=1 2']); // a real argv is never re-split
  // a rewritten command line must keep a data folder with spaces whole
  const rewritten = '/usr/lib/claude-desktop/claude-desktop --user-data-dir=/home/u/.config/Claude Multi Launcher/profiles/abc --class=claude-multi-abc claude://login/x';
  assert.equal(linux.parseUserDataDirArgs(linux.splitCmdline(rewritten)), '/home/u/.config/Claude Multi Launcher/profiles/abc');
  assert.deepEqual(linux.splitCmdline(rewritten).slice(-2), ['--class=claude-multi-abc', 'claude://login/x']);
});

test('processes that vanish or cannot be read are skipped', async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '55')); // directory with no files, as if the process just exited
  fakeProc(root, [{ pid: 56, argv: [EXE], exe: EXE }]);
  const found = await linux.scanInstances({ procRoot: root, claude });
  assert.deepEqual(found.map((i) => i.pid), [56]);
});

test('wmClassFor is stable and safe for a window class', () => {
  const a = linux.wmClassFor({ id: '3F2A9C1E-1111-4222-8333-444455556666' });
  assert.equal(a, 'claude-multi-3f2a9c1e');
  assert.equal(linux.wmClassFor({ id: '3F2A9C1E-1111-4222-8333-444455556666' }), a);
});

test('isClaudeLinkLaunch accepts Claude (or its wrapper script) carrying a link and nothing else', () => {
  const names = new Set(['claude-desktop']);
  assert.ok(isClaudeLinkLaunch(['/opt/Claude/claude-desktop', 'claude://login/google-auth?code=1'], names));
  assert.ok(isClaudeLinkLaunch(['/bin/sh', '/usr/bin/claude-desktop', 'claude://claude.ai/magic-link#x'], names));
  assert.ok(!isClaudeLinkLaunch(['/usr/bin/xdg-open', 'claude://login/google-auth'], names));
  assert.ok(!isClaudeLinkLaunch(['/bin/sh', '/usr/bin/xdg-open', 'claude://login/google-auth'], names));
  assert.ok(!isClaudeLinkLaunch(['/opt/Claude/claude-desktop'], names));
  assert.ok(!isClaudeLinkLaunch(['/usr/bin/firefox', 'claude://login'], names));
});

test('LinkWatcher reports a process that appears after it started, and ignores ones already there', async () => {
  const root = tmp();
  fakeProc(root, [{ pid: 10, argv: ['/opt/Claude/claude-desktop', 'claude://login/old'], exe: EXE }]);
  const w = new LinkWatcher(null, { procRoot: root });
  const seen = [];
  w.on('process', (m) => seen.push(m));
  w.start();
  assert.ok(w.running);
  fakeProc(root, [
    { pid: 11, argv: ['/usr/bin/xdg-open', 'claude://login/google-auth?code=1'] },
    { pid: 12, argv: ['/opt/Claude/claude-desktop', 'claude://login/google-auth?code=2'], exe: EXE },
  ]);
  await new Promise((r) => setTimeout(r, 120));
  w.stop();
  assert.ok(!w.running);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].pid, 12);
  assert.match(seen[0].commandLine, /code=2/);
});

test('snap: names, data folders and process matching', () => {
  assert.equal(linux.snapNameOf('/snap/bin/claude-ai-desktop'), 'claude-ai-desktop');
  assert.equal(linux.snapNameOf('/usr/bin/claude-desktop'), null);

  const p = linux.snapPaths('claude-ai-desktop', '/home/u');
  assert.equal(p.profilesRoot, '/home/u/snap/claude-ai-desktop/common/multi-launcher/profiles');
  assert.equal(p.defaultDataDir, '/home/u/snap/claude-ai-desktop/current/.config/claude-desktop');

  const snap = { snap: 'claude-ai-desktop', reals: new Set(), names: new Set() };
  assert.ok(linux.isClaudeProcess({ exe: '/snap/claude-ai-desktop/46/app/desktop-for-claude.bin', argv: [] }, snap));
  assert.ok(linux.isClaudeProcess({ exe: null, argv: ['/snap/claude-ai-desktop/47/app/desktop-for-claude.bin'] }, snap)); // exe not readable
  assert.ok(!linux.isClaudeProcess({ exe: '/usr/bin/snap', argv: ['snap', 'run', 'claude-ai-desktop'] }, snap));
  assert.ok(!linux.isClaudeProcess({ exe: '/snap/other/1/app/x', argv: [] }, snap));
});

test('snap: account folders in hidden places are refused with a clear message, others allowed', () => {
  const name = 'claude-ai-desktop';
  const home = '/home/u';
  assert.equal(linux.snapDataDirProblem('/home/u/snap/claude-ai-desktop/common/multi-launcher/profiles/a', name, home), null);
  assert.equal(linux.snapDataDirProblem('/home/u/ClaudeProfiles/a', name, home), null);
  assert.equal(linux.snapDataDirProblem('/data/profiles/a', name, home), null);
  assert.match(linux.snapDataDirProblem('/home/u/.config/Claude Multi Launcher/profiles/a', name, home), /hidden folders/);
});

test('start time is read from /proc stat, even when the command name contains spaces and brackets', async () => {
  const root = tmp();
  fakeProc(root, [{ pid: 7, ppid: 1, argv: [EXE], exe: EXE }]);
  fs.writeFileSync(path.join(root, 'stat'), 'cpu  1 2 3\nbtime 1000\n');
  // field 22 (starttime) is 500 ticks = 5 s after boot; the command name "(a (b) c)" must not shift the fields
  const fields = ['S', '1', ...Array(17).fill('0'), '500', '0'];
  fs.writeFileSync(path.join(root, '7', 'stat'), `7 (a (b) c) ${fields.join(' ')}\n`);
  const [inst] = await linux.scanInstances({ procRoot: root, claude });
  assert.equal(inst.startedAt, 1000 * 1000 + 5000);
});

test('account windows go through XWayland on a Wayland session so they can have their own window class', () => {
  assert.deepEqual(linux.windowSystemArgs({ XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }), ['--ozone-platform=x11']);
  assert.deepEqual(linux.windowSystemArgs({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }), ['--ozone-platform=x11']);
  assert.deepEqual(linux.windowSystemArgs({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }), []);
  assert.deepEqual(linux.windowSystemArgs({ XDG_SESSION_TYPE: 'wayland' }), []); // no XWayland to go through
  assert.deepEqual(linux.windowSystemArgs({ XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0', CML_NATIVE_WAYLAND: '1' }), []);
});
