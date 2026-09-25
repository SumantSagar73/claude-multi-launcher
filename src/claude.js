'use strict';

const { execFile, spawn } = require('node:child_process');
const path = require('node:path');

const PS = ['-NoProfile', '-NonInteractive', '-Command'];

function powershell(script, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [...PS, script], { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

let exeCache = { at: 0, value: null };

// The Store install lives in a versioned folder, so look it up each time instead of remembering a path.
async function findClaude() {
  if (exeCache.value && Date.now() - exeCache.at < 60_000) return exeCache.value;
  const out = await powershell(
    'Get-AppxPackage -Name Claude | Sort-Object Version -Descending | Select-Object -First 1 -ExpandProperty InstallLocation',
  );
  const dir = out.trim();
  if (!dir) throw new Error('Claude Desktop is not installed for this Windows user.');
  const exe = path.join(dir, 'app', 'Claude.exe');
  const version = (/Claude_([\d.]+)_/.exec(dir) || [])[1] || 'unknown';
  exeCache = { at: Date.now(), value: { exe, version } };
  return exeCache.value;
}

// Node quotes the whole argument when the path has a space ("--user-data-dir=C:\a b"), PowerShell users quote just the
// value (--user-data-dir="C:\a b"), and paths without spaces are bare. Handle all three.
const USER_DATA_ARG = /"--user-data-dir=([^"]*)"|--user-data-dir="([^"]*)"|--user-data-dir=(\S+)/i;

function parseUserDataDir(commandLine) {
  const m = USER_DATA_ARG.exec(commandLine || '');
  return m ? m[1] ?? m[2] ?? m[3] : null;
}

const norm = (p) => path.normalize(p).replace(/[\\/]+$/, '').toLowerCase();

/**
 * Running Claude Desktop instances, one per main process. A main process is a Claude.exe without --type=.
 * Instances started without --user-data-dir are the Default profile.
 * Returns [{ pid, dataDir|null, pids (whole process tree), memBytes }]
 */
async function scanInstances() {
  const out = await powershell(
    "Get-CimInstance Win32_Process -Filter \"Name='Claude.exe'\" | " +
      'Select-Object ProcessId,ParentProcessId,WorkingSetSize,ExecutablePath,CommandLine | ConvertTo-Json -Compress',
  );
  const text = out.trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  const procs = (Array.isArray(parsed) ? parsed : [parsed]).filter((p) =>
    (p.ExecutablePath || '').toLowerCase().includes('\\windowsapps\\claude_'),
  );

  const children = new Map();
  for (const p of procs) {
    if (!children.has(p.ParentProcessId)) children.set(p.ParentProcessId, []);
    children.get(p.ParentProcessId).push(p);
  }
  const treeOf = (p, seen = new Set()) => {
    if (seen.has(p.ProcessId)) return [];
    seen.add(p.ProcessId);
    return [p, ...(children.get(p.ProcessId) || []).flatMap((c) => treeOf(c, seen))];
  };

  return procs
    .filter((p) => !/--type=/.test(p.CommandLine || ''))
    .map((p) => {
      const tree = treeOf(p);
      return {
        pid: p.ProcessId,
        dataDir: parseUserDataDir(p.CommandLine),
        pids: tree.map((t) => t.ProcessId),
        memBytes: tree.reduce((sum, t) => sum + (t.WorkingSetSize || 0), 0),
      };
    });
}

// Which profile does a running instance belong to?
function matchInstance(instances, profile) {
  if (profile.isDefault) return instances.find((i) => i.dataDir === null) || null;
  const want = norm(profile.dataDir);
  return instances.find((i) => i.dataDir && norm(i.dataDir) === want) || null;
}

// Launching again with the same --user-data-dir hands the request (and any URL) to the running instance.
async function launchProfile(profile, url) {
  const { exe } = await findClaude();
  const args = [];
  if (!profile.isDefault) args.push(`--user-data-dir=${profile.dataDir}`);
  if (url) args.push(url);
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function taskkill(pid, force) {
  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true }, () => resolve());
  });
}

// Ask nicely first; Claude may only hide its window, so force the tree down if it is still there.
async function quitInstance(pid) {
  await taskkill(pid, false);
  await new Promise((r) => setTimeout(r, 3000));
  const still = (await scanInstances()).some((i) => i.pid === pid);
  if (still) await taskkill(pid, true);
}

module.exports = { findClaude, scanInstances, matchInstance, launchProfile, quitInstance, parseUserDataDir, norm };
