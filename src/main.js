'use strict';

const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, nativeImage, shell, clipboard, screen, globalShortcut } = require('electron');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const claude = require('./claude');
const router = require('./router');
const { LinkWatcher } = require('./linkwatch');
const { WindowHelper } = require('./winhelper');
const { folderSize } = require('./disk');
const { ProfileStore } = require('./profiles');
const { makeIconPng, makeAccountIconPng } = require('./icon');
const { pngsToIco } = require('./ico');
const { createShortcut } = require('./shortcut');
const { findLeftovers, removeLeftovers } = require('./handlercheck');
const { computeGrid } = require('./layout');

// Keep the same data folder name the earlier prototype used so existing profiles.json is picked up.
// CML_USER_DATA and CML_BACKGROUND_MS exist only so tests can run against a scratch folder and a short timer.
app.setPath('userData', process.env.CML_USER_DATA || path.join(app.getPath('appData'), 'Claude Multi Launcher'));

// Anything that goes wrong outside a button press still ends up in launcher.log instead of vanishing.
function logToFile(text) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'launcher.log'), `${new Date().toISOString()} ${text}\n`);
  } catch {
    // nothing else to do
  }
}
process.on('uncaughtException', (e) => logToFile(`UNCAUGHT ${e && e.stack ? e.stack : e}`));
process.on('unhandledRejection', (e) => logToFile(`UNHANDLED ${e && e.stack ? e.stack : e}`));

const arg = (name, argv = process.argv) => (argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || null;
const SCREENSHOT = arg('screenshot');
const HIDDEN = process.argv.includes('--hidden');
const OPEN_ARG = arg('open'); // launched from a per-account shortcut or hotkey

const WATCH_AFTER_OPEN_MS = 10 * 60 * 1000;
const WATCH_AFTER_AUTH_MS = 5 * 60 * 1000;
const DEDUPE_MS = 60 * 1000;
const BACKGROUND_AFTER_MS = Number(process.env.CML_BACKGROUND_MS) || 3 * 60 * 1000; // out of focus this long: release idle memory
const TRIM_EVERY_MS = Math.max(BACKGROUND_AFTER_MS, 15 * 1000);
const DISK_TTL_MS = 2 * 60 * 1000;
const AUTO_CLOSE_HOURS_OPTIONS = [0, 1, 3, 6, 12, 24]; // 0 = off
const HOTKEY_SLOTS = 10; // Ctrl+Alt+0..9

let store;
let watcher;
let helper;
let win = null;
let tray = null;
let quitting = false;
let snap = { profiles: [], running: new Map(), at: 0 };
let claudeInfo = null;
let claudeError = null;
let refreshTimer = null;
let trayKey = '';
let watchUntil = 0;
const lastLaunched = new Map(); // profile id -> ms
const lastFocused = new Map(); // profile id -> ms the account's window was last in front
const lastTrim = new Map(); // profile id -> ms
const trimJobs = new Map(); // nonce -> profile name
const disk = new Map(); // profile id -> { diskBytes, vmBytes, at }
let fgPid = 0;
let trimNonce = 0;
let layoutNonce = 0;
let hotkeyKey = '';
let lastClaudeVersion = null;
const warnedVersions = new Set();
const lastAutoCloseWarn = new Map(); // profile id -> ms, so an idle-close attempt is only noted once per account
const authSeen = new Map(); // profile id -> ms of the last sign-in page we noticed in its log
const recentLinks = new Map(); // link -> ms, so one link is never forwarded twice
const activity = []; // newest first, no secrets

function note(msg) {
  activity.unshift({ t: Date.now(), msg });
  activity.length = Math.min(activity.length, 25);
  console.log(`[launcher] ${msg}`);
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'launcher.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // logging is best effort
  }
  push();
}

// ---------- process state ----------

async function takeSnapshot() {
  const instances = await claude.scanInstances();
  const profiles = store.all();
  const running = new Map();
  for (const p of profiles) {
    const inst = claude.matchInstance(instances, p);
    if (inst) running.set(p.id, inst);
  }
  snap = { profiles, running, at: Date.now() };
  return snap;
}

async function refresh() {
  try {
    claudeInfo = await claude.findClaude();
    claudeError = null;
    await takeSnapshot();
    noticeClaudeUpdate();
    syncHelper();
  } catch (e) {
    claudeError = e.message;
  }
  push();
  rebuildTray();
  updateHotkeys();
  refreshDisk();
}

// Claude Desktop updates itself in place and can restart a running window on its own. This only observes the
// version Claude reports; it never triggers or blocks an update.
function noticeClaudeUpdate() {
  const v = claudeInfo && claudeInfo.version;
  if (!v || lastClaudeVersion === v) {
    if (v) lastClaudeVersion = v;
    return;
  }
  const previous = lastClaudeVersion;
  lastClaudeVersion = v;
  if (previous && !warnedVersions.has(v) && nonDefaultRunning().length > 0) {
    warnedVersions.add(v);
    note(`Claude Desktop updated (${previous} → ${v}). It may restart your open accounts on its own; reopen one if its window disappears.`);
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  const visible = win && win.isVisible() && !win.isMinimized();
  refreshTimer = setTimeout(async () => {
    await refresh();
    scheduleRefresh();
  }, visible ? 4000 : 20000);
}

function buildState() {
  const all = store.all();
  const profiles = all.map((p, i) => {
    const inst = snap.running.get(p.id);
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      isDefault: p.isDefault,
      dataDir: p.dataDir,
      email: p.email || '',
      running: !!inst,
      memMB: inst ? Math.round(inst.memBytes / 1048576) : 0,
      diskGB: p.isDefault ? null : toGB((disk.get(p.id) || {}).diskBytes || 0),
      vmGB: p.isDefault ? null : toGB((disk.get(p.id) || {}).vmBytes || 0),
      hotkey: i < HOTKEY_SLOTS ? `Ctrl+Alt+${i}` : null,
    };
  });
  return {
    profiles,
    claude: claudeInfo ? { version: claudeInfo.version } : null,
    claudeError,
    settings: {
      autoFreeMemory: store.settings.autoFreeMemory !== false,
      autoCloseHours: store.settings.autoCloseHours || 0,
      startWithWindows: app.isPackaged ? app.getLoginItemSettings().openAtLogin : false,
      canAutostart: app.isPackaged,
      canShortcuts: app.isPackaged,
    },
    watch: { active: watcher.running, secondsLeft: Math.max(0, Math.round((watchUntil - Date.now()) / 1000)) },
    activity: activity.map((a) => ({ t: a.t, msg: a.msg })),
  };
}

function push() {
  if (win && !win.isDestroyed()) win.webContents.send('state', buildState());
}

// ---------- window identity, memory and disk ----------
// Everything here applies to the launcher's own accounts only. The Default account is never styled, trimmed or closed.

const nonDefaultRunning = () => snap.profiles.filter((p) => !p.isDefault && snap.running.has(p.id));

function syncHelper() {
  const active = nonDefaultRunning();
  if (active.length === 0) {
    helper.stop();
    return;
  }
  helper.setWindows(
    active.map((p) => ({
      pid: snap.running.get(p.id).pid,
      aumid: `ClaudeMultiLauncher.${p.id}`,
      label: p.name,
      color: p.color,
      initial: (p.name.trim()[0] || '?').toUpperCase(),
    })),
  );
  helper.start();
}

function profileOfPid(pid) {
  for (const p of snap.profiles) {
    const inst = snap.running.get(p.id);
    if (inst && inst.pids.includes(pid)) return p;
  }
  return null;
}

function trimProfile(id) {
  const p = store.get(id);
  if (!p || p.isDefault) throw new Error('The launcher does not trim your Default Claude.');
  const inst = snap.running.get(id);
  if (!inst) return;
  trimNonce += 1;
  trimJobs.set(trimNonce, p.name);
  lastTrim.set(id, Date.now());
  helper.start();
  helper.requestTrim(trimNonce, inst.pids);
}

// Accounts left in the background give their idle memory back; Windows pages it in again when the account is used.
function autoTrim() {
  if (store.settings.autoFreeMemory === false) return;
  const now = Date.now();
  for (const p of nonDefaultRunning()) {
    const inst = snap.running.get(p.id);
    if (inst.pids.includes(fgPid)) {
      lastFocused.set(p.id, now);
      continue;
    }
    if (!lastFocused.has(p.id)) lastFocused.set(p.id, now);
    if (now - lastFocused.get(p.id) > BACKGROUND_AFTER_MS && now - (lastTrim.get(p.id) || 0) > TRIM_EVERY_MS) {
      trimProfile(p.id);
    }
  }
}

// Opt-in: an account left in the background for longer than the chosen number of hours is closed outright, not just
// trimmed. Off by default. Never applied to Default.
function autoCloseIdle() {
  const hours = store.settings.autoCloseHours || 0;
  if (!hours) return;
  const cutoff = hours * 60 * 60 * 1000;
  const now = Date.now();
  for (const p of nonDefaultRunning()) {
    const idleSince = lastFocused.get(p.id);
    if (!idleSince || now - idleSince < cutoff) continue;
    if (now - (lastAutoCloseWarn.get(p.id) || 0) < 60 * 1000) continue; // one attempt per minute if it keeps failing
    lastAutoCloseWarn.set(p.id, now);
    const inst = snap.running.get(p.id);
    if (!inst) continue;
    note(`${p.name} has been idle for over ${hours}h; closing it.`);
    claude.quitInstance(inst.pid).then(refresh);
  }
}

// ---------- tiling and per-account shortcuts ----------

function tileRunningWindows() {
  const targets = nonDefaultRunning();
  if (targets.length === 0) throw new Error('No accounts are open to tile.');
  const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  const rects = computeGrid(targets.length, display.workArea);
  helper.start();
  layoutNonce += 1;
  helper.requestLayout(
    layoutNonce,
    targets.map((p, i) => ({ pid: snap.running.get(p.id).pid, ...rects[i] })),
  );
}

async function makeAccountShortcut(id) {
  if (!app.isPackaged) {
    throw new Error('Shortcuts need the installed app: run "npm run package" then "npm run install-app", then use the installed copy.');
  }
  const p = store.get(id);
  if (!p) throw new Error('Account not found.');

  const iconDir = path.join(app.getPath('userData'), 'icons');
  fs.mkdirSync(iconDir, { recursive: true });
  const iconPath = path.join(iconDir, `${p.id}.ico`);
  const sizes = [16, 32, 48, 256];
  fs.writeFileSync(
    iconPath,
    pngsToIco(sizes, sizes.map((s) => makeAccountIconPng(s, p.color))),
  );

  const startMenuDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Claude Multi Launcher');
  fs.mkdirSync(startMenuDir, { recursive: true });
  const safeName = p.name.replace(/[\\/:*?"<>|]/g, '_');
  const linkPath = path.join(startMenuDir, `${safeName}.lnk`);

  await createShortcut({
    linkPath,
    targetPath: process.execPath,
    args: `--open="${p.name}"`,
    workingDir: path.dirname(process.execPath),
    iconPath,
    description: `Open ${p.name} in Claude Multi Launcher`,
  });
  return safeName;
}

async function refreshDisk() {
  if (!win || !win.isVisible()) return;
  const now = Date.now();
  await Promise.all(
    snap.profiles
      .filter((p) => !p.isDefault && now - ((disk.get(p.id) || {}).at || 0) > DISK_TTL_MS)
      .map(async (p) => {
        disk.set(p.id, { ...(disk.get(p.id) || {}), at: now });
        const [diskBytes, vmBytes] = await Promise.all([folderSize(p.dataDir), folderSize(path.join(p.dataDir, 'vm_bundles'))]);
        disk.set(p.id, { diskBytes, vmBytes, at: Date.now() });
      }),
  );
  push();
}

const toGB = (b) => Math.round((b / 1073741824) * 10) / 10;

// ---------- catching sign-in links ----------

function readTail(file, bytes = 16384) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, bytes);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function logPathFor(p) {
  return p.isDefault
    ? path.join(process.env.LOCALAPPDATA || '', 'Claude', 'logs', 'main.log')
    : path.join(p.dataDir, 'logs', 'main.log');
}

// Claude logs "[Auth] Using system browser" when a profile opens its sign-in page, which tells us who started it.
function lastAuthTime(p) {
  const re = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \[\w+\] \[Auth\] Using system browser/gm;
  let last = null;
  for (const m of readTail(logPathFor(p)).matchAll(re)) last = m;
  if (!last) return null;
  const t = new Date(`${last[1]}T${last[2]}`).getTime();
  return Number.isFinite(t) ? t : null;
}

function collectLoginHints(running, profiles) {
  const hints = new Map();
  for (const p of profiles) {
    if (!running.has(p.id)) continue;
    const t = lastAuthTime(p);
    if (t) hints.set(p.id, t);
  }
  return hints;
}

// Cheap check (a file read per running account, once a second) that switches the watcher on when someone signs in.
function noticeSignInStarts() {
  for (const p of snap.profiles) {
    if (p.isDefault || !snap.running.has(p.id)) continue;
    const t = lastAuthTime(p);
    if (t && t > (authSeen.get(p.id) || 0)) {
      authSeen.set(p.id, t);
      if (Date.now() - t < WATCH_AFTER_AUTH_MS) {
        armWatch(WATCH_AFTER_AUTH_MS);
        note(`${p.name} opened its sign-in page. Watching for the sign-in link.`);
      }
    }
  }
}

function armWatch(ms) {
  watchUntil = Math.max(watchUntil, Date.now() + ms);
  syncWatcher();
  push();
}

function syncWatcher() {
  if (Date.now() < watchUntil) watcher.start();
  else watcher.stop();
}

// Windows hands every claude:// link to the Default Claude, which refuses a sign-in it did not start. The link is
// on the command line of the Claude.exe process Windows just started, so pass it to the account that did start it.
async function onClaudeProcess({ commandLine }) {
  // Links the launcher forwarded itself, or other profiles' own processes, carry these flags. Only ignore those.
  if (/--user-data-dir|--type=/.test(commandLine)) return;
  const url = router.extractClaudeUrl(commandLine);
  if (!url || !router.isLoginCallback(url)) return;

  const now = Date.now();
  if (now - (recentLinks.get(url) || 0) < DEDUPE_MS) return;
  recentLinks.set(url, now);
  for (const [k, t] of recentLinks) if (now - t > DEDUPE_MS) recentLinks.delete(k);

  try {
    const { profiles, running } = await takeSnapshot();
    const choice = router.chooseLoginTarget({
      profiles,
      running: new Set(running.keys()),
      hints: collectLoginHints(running, profiles),
      lastLaunched,
      now,
    });
    const what = router.describeUrl(url);
    if (choice.id === 'default') {
      note(`Sign-in link ${what} belongs to Default (${choice.reason}); left alone.`);
      return;
    }
    const target = profiles.find((p) => p.id === choice.id);
    await claude.launchProfile(target, url);
    lastLaunched.set(target.id, Date.now());
    note(`Sign-in link ${what} → ${target.name} (${choice.reason})`);
  } catch (e) {
    note(`Could not pass on the sign-in link: ${e.message}`);
  }
  refresh();
}

// ---------- actions from the window ----------

const confirmBox = (opts) => dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, opts);

const actions = {
  async open(id) {
    const p = store.get(id);
    if (!p) throw new Error('Account not found.');
    lastLaunched.set(id, Date.now());
    if (!p.isDefault) armWatch(WATCH_AFTER_OPEN_MS);
    await claude.launchProfile(p);
    note(`Opened ${p.name}`);
    setTimeout(refresh, 2500);
    setTimeout(refresh, 7000);
  },

  async quit(id) {
    // The Default account is the user's own Claude with their data. The launcher never closes it.
    if (id === 'default') throw new Error('The launcher does not close your Default Claude. Close it yourself if you want to.');
    const inst = snap.running.get(id);
    if (!inst) return;
    const p = store.get(id);
    note(`Closing ${p.name}…`);
    await claude.quitInstance(inst.pid);
    await refresh();
  },

  async add({ name, color, email, copyFrom }) {
    const source = copyFrom ? store.get(copyFrom) : null;
    const p = store.add({ name, color, email });
    if (source) {
      // A read of the source's MCP server list, explicitly requested by the user for this one file. Nothing else
      // is copied, and nothing is ever written back to the source (including Default).
      const from = path.join(source.dataDir, 'claude_desktop_config.json');
      const to = path.join(p.dataDir, 'claude_desktop_config.json');
      try {
        if (fs.existsSync(from)) {
          fs.mkdirSync(p.dataDir, { recursive: true });
          fs.copyFileSync(from, to);
          note(`Added ${p.name}, with ${source.name}'s MCP server settings copied in.`);
        } else {
          note(`Added ${p.name}. ${source.name} has no MCP settings file yet, so none were copied.`);
        }
      } catch (e) {
        note(`Added ${p.name}, but could not copy settings from ${source.name}: ${e.message}`);
      }
    } else {
      note(`Added ${p.name}. Press Open, then sign in inside its window.`);
    }
    await refresh();
  },

  async update({ id, name, color, email }) {
    store.update(id, { name, color, email });
    await refresh();
  },

  async remove(id) {
    const p = store.get(id);
    if (!p || p.isDefault) throw new Error('This account cannot be removed.');
    if (snap.running.has(id)) throw new Error(`Close ${p.name} before removing it.`);
    const { response } = await confirmBox({
      type: 'warning',
      message: `Remove “${p.name}”?`,
      detail: 'Deleting its data signs it out and erases its local chats, settings and downloaded files. Your account itself is not affected.',
      buttons: ['Remove and delete data', 'Remove, keep data', 'Cancel'],
      defaultId: 2,
      cancelId: 2,
    });
    if (response === 2) return;
    store.remove(id, { deleteData: response === 0 });
    note(`Removed ${p.name}`);
    await refresh();
  },

  async reveal(id) {
    const p = store.get(id);
    if (!p) return;
    fs.mkdirSync(p.dataDir, { recursive: true });
    await shell.openPath(p.dataDir);
  },

  async trim(id) {
    trimProfile(id);
  },

  async setting({ key, value }) {
    if (key === 'autoFreeMemory') {
      store.setSetting('autoFreeMemory', !!value);
    } else if (key === 'autoCloseHours') {
      const hours = Number(value) || 0;
      if (!AUTO_CLOSE_HOURS_OPTIONS.includes(hours)) throw new Error('Not a valid auto-close time.');
      store.setSetting('autoCloseHours', hours);
      lastAutoCloseWarn.clear();
    } else if (key === 'startWithWindows') {
      if (!app.isPackaged) throw new Error('Start with Windows is available in the installed app (see the README).');
      app.setLoginItemSettings({ openAtLogin: !!value, args: ['--hidden'] });
    } else {
      throw new Error('Unknown setting.');
    }
    push();
  },

  async tile() {
    tileRunningWindows();
  },

  async shortcut(id) {
    const name = await makeAccountShortcut(id);
    note(`Created a Start Menu shortcut for ${store.get(id).name}. Search "${name}" in the Start menu, or run it with --open="${store.get(id).name}".`);
  },

  async export() {
    if (!win) throw new Error('No window to show the save dialog on.');
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export accounts',
      defaultPath: 'claude-multi-launcher-accounts.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return;
    const state = buildState();
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      profiles: state.profiles.filter((p) => !p.isDefault).map((p) => ({ name: p.name, color: p.color, email: p.email })),
      settings: { autoFreeMemory: state.settings.autoFreeMemory, autoCloseHours: state.settings.autoCloseHours },
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    note(`Exported ${payload.profiles.length} account${payload.profiles.length === 1 ? '' : 's'} (names, colours and emails only; no logins).`);
  },

  async import() {
    if (!win) throw new Error('No window to show the open dialog on.');
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import accounts',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    } catch (e) {
      throw new Error(`Could not read that file: ${e.message}`);
    }
    const { added, skipped } = store.importAccounts(data.profiles);
    if (data.settings) {
      if (typeof data.settings.autoFreeMemory === 'boolean') store.setSetting('autoFreeMemory', data.settings.autoFreeMemory);
      if (AUTO_CLOSE_HOURS_OPTIONS.includes(data.settings.autoCloseHours)) store.setSetting('autoCloseHours', data.settings.autoCloseHours);
    }
    note(
      `Imported ${added.length} account${added.length === 1 ? '' : 's'}${added.length ? ` (${added.join(', ')})` : ''}.` +
        (skipped.length ? ` Skipped ${skipped.length} that already existed: ${skipped.join(', ')}.` : ''),
    );
    await refresh();
  },

  async health() {
    const leftovers = await findLeftovers();
    return {
      checks: [
        { label: 'Claude Desktop found', ok: !!claudeInfo, detail: claudeInfo ? `version ${claudeInfo.version}` : claudeError || 'not found' },
        {
          label: 'Sign-in link handling is clean',
          ok: leftovers.length === 0,
          detail: leftovers.length === 0 ? 'no leftover registration' : 'a leftover registration could make Windows show an "Open with" prompt for Claude links',
          fixable: leftovers.length > 0,
        },
        { label: 'Window styling helper', ok: nonDefaultRunning().length === 0 || helper.running, detail: helper.running ? 'running' : 'stopped (fine when no account is open)' },
        { label: 'Sign-in watcher', ok: true, detail: watcher.running ? `watching, ${Math.max(0, Math.round((watchUntil - Date.now()) / 1000))}s left` : 'idle (fine when no sign-in is in progress)' },
      ],
    };
  },

  async 'health:clean'() {
    await removeLeftovers();
    note('Removed a leftover Windows registration for claude:// links.');
    push();
  },

  async copy(text) {
    clipboard.writeText(String(text ?? '').slice(0, 50000));
  },

  async diagnostics() {
    const state = buildState();
    const logTail = readTail(path.join(app.getPath('userData'), 'launcher.log'), 6000).split(/\r?\n/).slice(-40).join('\n');
    const lines = [
      `Claude Multi Launcher ${app.getVersion()}${app.isPackaged ? ' (installed build)' : ' (from source)'}`,
      `Electron ${process.versions.electron}, Windows ${os.release()}, Claude Desktop ${state.claude ? state.claude.version : 'not found'}`,
      state.claudeError ? `Claude problem: ${state.claudeError}` : null,
      '',
      'Accounts (no emails, no paths):',
      ...state.profiles.map(
        (p) => `  ${p.isDefault ? '[Default] ' : ''}${p.name}: ${p.running ? `running, ${p.memMB} MB RAM` : 'not running'}${p.diskGB ? `, ${p.diskGB} GB disk` : ''}`,
      ),
      '',
      `Sign-in watcher: ${state.watch.active ? `on, ${state.watch.secondsLeft}s left` : 'idle'}`,
      `Window helper: ${helper.running ? 'running' : 'stopped'}`,
      `Free memory from idle accounts: ${state.settings.autoFreeMemory ? 'on' : 'off'}`,
      '',
      'Recent log:',
      logTail,
    ].filter((l) => l !== null);
    clipboard.writeText(lines.join('\n'));
    note('Diagnostics copied to the clipboard.');
  },

  async 'watch:arm'() {
    armWatch(WATCH_AFTER_OPEN_MS);
    note('Watching for sign-in links for the next 10 minutes.');
  },
};

ipcMain.handle('state:get', () => buildState());
ipcMain.handle('action', async (_e, name, payload) => {
  if (!Object.hasOwn(actions, name)) return { ok: false, error: 'Unknown action.' };
  try {
    const result = await actions[name](payload);
    return { ok: true, result };
  } catch (e) {
    note(`“${name}” failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// ---------- window & tray ----------

function createWindow() {
  win = new BrowserWindow({
    width: 540,
    height: 720,
    minWidth: 420,
    minHeight: 480,
    show: false,
    backgroundColor: '#141210',
    title: 'Multi Launcher',
    icon: nativeImage.createFromBuffer(makeIconPng(64)),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#141210', symbolColor: '#ece6dd', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!HIDDEN && !SCREENSHOT && !OPEN_ARG) win.show();
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('show', () => {
    refresh();
    scheduleRefresh();
  });
  // Links inside the UI never navigate the launcher itself.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// Resolves a --open value (from a per-account shortcut or hotkey) to a profile and opens it. Shows the launcher
// window only if the value could not be matched, so the user can see why.
function openAccountByArg(value) {
  const match = router.matchProfileArg(store.all(), value);
  if (!match) {
    note(`Could not find an account named "${value}" to open.`);
    showWindow();
    return;
  }
  actions.open(match.id).catch((e) => note(`Could not open ${match.name}: ${e.message}`));
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function rebuildTray() {
  if (!tray) return;
  const profiles = store.all();
  const key = profiles.map((p) => `${p.id}:${p.name}:${snap.running.has(p.id)}`).join('|');
  if (key === trayKey) return;
  trayKey = key;
  const items = profiles.map((p) => ({
    label: `${snap.running.has(p.id) ? '● ' : '○ '}${p.name}`,
    click: () => actions.open(p.id).catch((e) => dialog.showErrorBox('Could not open account', e.message)),
  }));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...items,
      { type: 'separator' },
      { label: 'Show launcher', click: showWindow },
      { label: 'Quit launcher', click: () => { quitting = true; app.quit(); } },
    ]),
  );
}

function createTray() {
  tray = new Tray(nativeImage.createFromBuffer(makeIconPng(64)).resize({ width: 32, height: 32 }));
  tray.setToolTip('Claude Multi Launcher');
  tray.on('click', showWindow);
}

// Ctrl+Alt+0..9 open the first 10 accounts in list order (0 = Default). Re-registered whenever the list changes.
function updateHotkeys() {
  const ids = store.all().slice(0, HOTKEY_SLOTS).map((p) => p.id);
  const key = ids.join('|');
  if (key === hotkeyKey) return;
  hotkeyKey = key;
  globalShortcut.unregisterAll();
  ids.forEach((id, i) => {
    globalShortcut.register(`CommandOrControl+Alt+${i}`, () => {
      actions.open(id).catch((e) => note(`Hotkey could not open the account: ${e.message}`));
    });
  });
}

// ---------- start-up ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const openArg = arg('open', argv);
    if (openArg) openAccountByArg(openArg);
    else showWindow();
  });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true;
    if (watcher) watcher.stop();
    if (helper) helper.stop();
    globalShortcut.unregisterAll();
  });

  app.whenReady().then(async () => {
    store = new ProfileStore(app.getPath('userData'), path.join(app.getPath('appData'), 'Claude'));
    watcher = new LinkWatcher(app.getPath('userData'));
    watcher.on('process', onClaudeProcess);
    watcher.on('error-text', (t) => note(`Sign-in watcher problem: ${String(t).split(/\r?\n/)[0].slice(0, 160)}`));
    helper = new WindowHelper(app.getPath('userData'));
    helper.on('foreground', (pid) => {
      fgPid = pid;
      const p = profileOfPid(pid);
      if (p) lastFocused.set(p.id, Date.now());
    });
    helper.on('trimmed', ({ nonce, beforeMB, afterMB }) => {
      const name = trimJobs.get(nonce);
      trimJobs.delete(nonce);
      if (name && beforeMB - afterMB > 50) note(`Freed about ${beforeMB - afterMB} MB of memory from ${name}.`);
      setTimeout(refresh, 1500);
    });
    helper.on('error-text', (t) => note(`Window helper problem: ${String(t).split(/\r?\n/)[0].slice(0, 160)}`));
    helper.on('tiled', ({ moved }) => note(`Tiled ${moved} account window${moved === 1 ? '' : 's'}.`));
    createTray();
    // Populate claudeInfo etc. before the window (and so the renderer's first getState()/health() calls) exists,
    // so the UI never has a moment where it reports Claude "not found" purely because the check hadn't run yet.
    await refresh();
    createWindow();
    scheduleRefresh();

    if (OPEN_ARG) openAccountByArg(OPEN_ARG);

    // Accounts that are already open when the launcher starts may be mid sign-in.
    if (snap.profiles.some((p) => !p.isDefault && snap.running.has(p.id))) armWatch(WATCH_AFTER_OPEN_MS);

    setInterval(() => {
      noticeSignInStarts();
      autoTrim();
      autoCloseIdle();
      const was = watcher.running;
      syncWatcher();
      if (was !== watcher.running) push();
    }, 1000);

    if (SCREENSHOT) {
      // Debug aid: render once, save a PNG, quit. Used to check the UI without driving it by hand.
      if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
      win.show();
      if (process.env.CML_ZOOM) win.webContents.setZoomFactor(Number(process.env.CML_ZOOM));
      await new Promise((r) => setTimeout(r, 1200));
      if (process.env.CML_CLICK) {
        // Test-only: click a selector (e.g. to open a dialog) before capturing.
        await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(process.env.CML_CLICK)})?.click()`);
        await new Promise((r) => setTimeout(r, 400));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(SCREENSHOT, img.toPNG());
      quitting = true;
      watcher.stop();
      helper.stop();
      globalShortcut.unregisterAll();
      app.exit(0);
    }
  });
}
