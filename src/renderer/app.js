'use strict';

const PALETTE = ['#e07a5f', '#e8a23a', '#81b29a', '#6fa8dc', '#8e7dbe', '#d16ba5', '#4db6ac', '#a39b90'];

const $ = (id) => document.getElementById(id);
const rowEls = new Map();
let state = null;
let toastTimer = null;

// ---------- tiny DOM helpers (all text goes through textContent, never innerHTML) ----------

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

function icon(paths) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

const ICONS = {
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
  folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
  zap: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  link: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14 21 3'],
};

// Errors stay until dismissed and can be copied; plain confirmations fade on their own.
function toast(msg, isError) {
  const t = $('toast');
  t.classList.toggle('error', !!isError);
  t.replaceChildren(
    h('span', { class: 'toast-text' }, msg),
    ...(isError
      ? [
          h('button', { class: 'toast-btn', type: 'button', onclick: async () => { await window.launcher.action('copy', msg); toast('Copied.'); } }, 'Copy'),
          h('button', { class: 'toast-btn', type: 'button', onclick: () => { t.hidden = true; } }, 'Dismiss'),
        ]
      : []),
  );
  t.hidden = false;
  clearTimeout(toastTimer);
  if (!isError) toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

async function run(name, payload) {
  const res = await window.launcher.action(name, payload);
  if (!res.ok) toast(res.error, true);
  return res;
}

// Anything unexpected in this window is shown too, instead of disappearing into a console nobody can see.
window.addEventListener('error', (e) => toast(`Window error: ${e.message}`, true));
window.addEventListener('unhandledrejection', (e) => toast(`Window error: ${e.reason && e.reason.message ? e.reason.message : e.reason}`, true));

// ---------- account rows (updated in place so hover/focus survive the periodic refresh) ----------

function makeRow(p) {
  const avatar = h('div', { class: 'avatar', 'aria-hidden': 'true' });
  const name = h('span', { class: 'name' });
  const tag = h('span', { class: 'tag' }, 'Default');
  const hotkey = h('span', { class: 'tag hotkey-tag' });
  const meta = h('span', {});
  const email = h('div', { class: 'email' });
  const info = h('div', { class: 'info' }, h('div', { class: 'name-line' }, name, tag, hotkey), email, h('div', { class: 'meta' }, h('span', { class: 'dot' }), meta));

  const edit = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Rename or recolour', title: 'Rename or recolour', onclick: () => openDialog(p.id) }, icon(ICONS.edit));
  const folder = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Show data folder', title: 'Show data folder', onclick: () => run('reveal', p.id) }, icon(ICONS.folder));
  const free = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Free memory', title: 'Free memory now', onclick: () => run('trim', p.id) }, icon(ICONS.zap));
  const shortcut = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Make a shortcut', title: 'Make a Start Menu shortcut for this account', onclick: () => run('shortcut', p.id) }, icon(ICONS.link));
  const remove = h('button', { class: 'icon-btn danger', type: 'button', 'aria-label': 'Remove account', title: 'Remove account', onclick: () => run('remove', p.id) }, icon(ICONS.trash));
  const quit = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Quit');
  const open = h('button', { class: 'btn', type: 'button' }, 'Open');

  quit.addEventListener('click', async () => { quit.disabled = true; await run('quit', p.id); quit.disabled = false; });
  open.addEventListener('click', () => run('open', p.id));

  const li = h('li', { class: 'row', 'data-id': p.id }, avatar, info, h('div', { class: 'actions' }, h('div', { class: 'tools' }, free, shortcut, edit, folder, remove), quit, open));
  return { li, avatar, name, tag, hotkey, email, meta, free, shortcut, remove, quit, open };
}

function updateRow(r, p, canShortcuts) {
  r.li.classList.toggle('is-running', p.running);
  r.avatar.style.setProperty('--c', p.color);
  r.avatar.textContent = (p.name.trim()[0] || '?').toUpperCase();
  r.name.textContent = p.name;
  r.tag.hidden = !p.isDefault;
  r.hotkey.hidden = !p.hotkey;
  r.hotkey.textContent = p.hotkey || '';
  r.hotkey.title = p.hotkey ? `Press ${p.hotkey} anywhere to open or focus this account` : '';
  r.email.textContent = p.email || 'No email added';
  r.email.classList.toggle('is-empty', !p.email);
  const parts = [p.running ? `Running${p.memMB ? ` · ${(p.memMB / 1024).toFixed(1)} GB RAM` : ''}` : 'Not running'];
  if (p.diskGB) parts.push(`${p.diskGB} GB on disk${p.vmGB ? ` (Cowork VM ${p.vmGB} GB)` : ''}`);
  r.meta.textContent = parts.join(' · ');
  r.free.hidden = !p.running || p.isDefault;
  r.shortcut.hidden = !canShortcuts;
  r.remove.hidden = p.isDefault;
  r.quit.hidden = !p.running || p.isDefault;
  r.open.textContent = p.running ? 'Focus' : 'Open';
}

function renderList(s) {
  const seen = new Set();
  const list = $('list');
  s.profiles.forEach((p, i) => {
    seen.add(p.id);
    let r = rowEls.get(p.id);
    if (!r) {
      r = makeRow(p);
      r.li.style.animationDelay = `${i * 50}ms`;
      rowEls.set(p.id, r);
    }
    updateRow(r, p, s.settings.canShortcuts);
    if (list.children[i] !== r.li) list.insertBefore(r.li, list.children[i] || null);
  });
  for (const [id, r] of rowEls) {
    if (!seen.has(id)) { r.li.remove(); rowEls.delete(id); }
  }
  $('empty').hidden = s.profiles.length > 1;

  const runningCount = s.profiles.filter((p) => !p.isDefault && p.running).length;
  $('tile').hidden = runningCount < 2;
}

// ---------- link routing card ----------

function renderLinks(s) {
  const { active, secondsLeft } = s.watch;
  $('pill').className = 'pill' + (active ? ' on' : '');
  $('pill-text').textContent = active ? `Watching · ${Math.max(1, Math.ceil(secondsLeft / 60))} min left` : 'Idle';
  $('links-text').textContent = active
    ? 'When a browser sign-in finishes, Windows hands the link to your default Claude. The launcher catches it and passes it to the account that started the sign-in.'
    : 'Turns on by itself when you open an account or start a sign-in, so signing in to another account completes in the right window. Press the button if a sign-in needs more time.';
  $('watch').textContent = active ? 'Extend by 10 minutes' : 'Watch for 10 minutes';
}

function renderSettings(s) {
  $('set-trim').checked = s.settings.autoFreeMemory;
  const auto = $('set-autostart');
  auto.checked = s.settings.startWithWindows;
  auto.disabled = !s.settings.canAutostart;
  $('autostart-hint').textContent = s.settings.canAutostart
    ? 'Opens the launcher in the tray when you sign in to Windows.'
    : 'Available in the installed app. See the README to build and install it.';
  const autoclose = $('set-autoclose');
  if (document.activeElement !== autoclose) autoclose.value = String(s.settings.autoCloseHours);
}

// ---------- health check (polled on its own timer; touches the registry, so not on every state push) ----------

function renderHealth(checks) {
  $('health-list').replaceChildren(
    ...checks.map((c) =>
      h(
        'li',
        { class: 'health-row' },
        h('span', { class: 'health-dot' + (c.ok ? ' ok' : ' warn') }),
        h('div', { class: 'health-text' }, h('div', { class: 'health-label' }, c.label), h('div', { class: 'muted small' }, c.detail)),
        c.fixable ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => run('health:clean') }, 'Fix') : null,
      ),
    ),
  );
}

let lastChecks = [];

async function refreshHealth() {
  const res = await window.launcher.action('health');
  if (res.ok) {
    lastChecks = res.result.checks;
    renderHealth(lastChecks);
    renderStatusDot();
  }
}

// ---------- titlebar status + settings dialog ----------

function renderStatusDot() {
  const dot = $('status-dot');
  const problems = lastChecks.filter((c) => !c.ok);
  const isProblem = !!(state && state.claudeError) || problems.length > 0;
  dot.className = 'status-dot' + (isProblem ? ' warn' : lastChecks.length ? ' ok' : '');
  dot.title = isProblem
    ? [state && state.claudeError, ...problems.map((c) => c.label)].filter(Boolean).join(' · ')
    : 'Everything looks fine. Click for settings.';
}

const settingsDlg = $('settings-dlg');
$('open-settings').addEventListener('click', () => { refreshHealth(); settingsDlg.showModal(); });
$('status-dot').addEventListener('click', () => { refreshHealth(); settingsDlg.showModal(); });
$('settings-close').addEventListener('click', () => settingsDlg.close());

function renderActivity(s) {
  $('activity').replaceChildren(
    ...s.activity.map((a) => h('li', {}, h('time', {}, new Date(a.t).toLocaleTimeString([], { hour12: false })), a.msg)),
  );
  $('activity-empty').hidden = s.activity.length > 0;
}

function render(s) {
  state = s;
  const banner = $('banner');
  banner.hidden = !s.claudeError;
  banner.textContent = s.claudeError || '';
  renderList(s);
  renderLinks(s);
  renderSettings(s);
  renderActivity(s);
  renderStatusDot();
  $('foot').textContent = s.claude ? `Claude Desktop ${s.claude.version}` : '';
}

// ---------- add / edit dialog ----------

const dlg = $('dlg');
let editingId = null;

function buildSwatches(selected) {
  $('swatches').replaceChildren(
    ...PALETTE.map((c) => {
      const input = h('input', { type: 'radio', name: 'color', value: c, 'aria-label': c, checked: c === selected });
      const label = h('label', { class: 'swatch' }, input, h('span', {}));
      label.style.setProperty('--c', c);
      return label;
    }),
  );
}

function openDialog(id) {
  editingId = id || null;
  const p = id ? state.profiles.find((x) => x.id === id) : null;
  $('dlg-title').textContent = p ? 'Edit account' : 'Add account';
  $('dlg-name').value = p ? p.name : '';
  $('dlg-email').value = p ? p.email : '';
  const used = new Set(state.profiles.map((x) => x.color));
  buildSwatches(p ? p.color : PALETTE.find((c) => !used.has(c)) || PALETTE[0]);

  const copyRow = $('dlg-copyfrom-row');
  copyRow.hidden = !!p; // only offered when adding a new account
  if (!p) {
    const sel = $('dlg-copyfrom');
    sel.replaceChildren(
      h('option', { value: '' }, "Don't copy"),
      ...state.profiles.map((x) => h('option', { value: x.id }, x.isDefault ? `${x.name} (Default)` : x.name)),
    );
    sel.value = '';
  }

  $('dlg-error').hidden = true;
  dlg.showModal();
  $('dlg-name').focus();
  $('dlg-name').select();
}

$('add').addEventListener('click', () => openDialog(null));
$('dlg-cancel').addEventListener('click', () => dlg.close());

let saving = false;

$('dlg-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (saving) return; // a second click or Enter while the first save is still running must not add a second account
  saving = true;
  $('dlg-save').disabled = true;
  try {
    const color = (document.querySelector('input[name="color"]:checked') || {}).value;
    const payload = { name: $('dlg-name').value, email: $('dlg-email').value, color };
    if (!editingId && $('dlg-copyfrom').value) payload.copyFrom = $('dlg-copyfrom').value;
    const res = editingId ? await window.launcher.action('update', { id: editingId, ...payload }) : await window.launcher.action('add', payload);
    if (res.ok) dlg.close();
    else {
      $('dlg-error').textContent = res.error;
      $('dlg-error').hidden = false;
    }
  } finally {
    saving = false;
    $('dlg-save').disabled = false;
  }
});

// ---------- wiring ----------

$('watch').addEventListener('click', () => run('watch:arm'));
$('copy-diag').addEventListener('click', async () => {
  const res = await run('diagnostics');
  if (res.ok) toast('Diagnostics copied. Paste them wherever you need.');
});
$('set-trim').addEventListener('change', (e) => run('setting', { key: 'autoFreeMemory', value: e.target.checked }));
$('set-autostart').addEventListener('change', (e) => run('setting', { key: 'startWithWindows', value: e.target.checked }));
$('set-autoclose').addEventListener('change', (e) => run('setting', { key: 'autoCloseHours', value: Number(e.target.value) }));
$('tile').addEventListener('click', () => run('tile'));
$('export').addEventListener('click', () => run('export'));
$('import').addEventListener('click', () => run('import'));

window.launcher.onState(render);
window.launcher.getState().then(render);
refreshHealth();
setInterval(refreshHealth, 15000);
