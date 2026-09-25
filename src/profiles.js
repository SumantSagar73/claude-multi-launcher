'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const DEFAULT_COLOR = '#a39b90';

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function cleanName(name) {
  const n = String(name ?? '').trim().slice(0, 40);
  if (!n) throw new Error('Give the account a name.');
  return n;
}

// Optional label so the user can tell accounts apart. Claude does not store the address in a readable place.
function cleanEmail(email) {
  const e = String(email ?? '').trim().slice(0, 120);
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('That does not look like an email address.');
  return e;
}

function cleanColor(color) {
  if (!COLOR_RE.test(color || '')) throw new Error('Pick a colour.');
  return color.toLowerCase();
}

class ProfileStore {
  constructor(userDataDir, claudeDataDir) {
    this.profilesFile = path.join(userDataDir, 'profiles.json');
    this.settingsFile = path.join(userDataDir, 'settings.json');
    this.profilesRoot = path.join(userDataDir, 'profiles');
    this.claudeDataDir = claudeDataDir;
    this.list = readJson(this.profilesFile, []).filter((p) => p && p.id && p.dataDir);
    this.settings = readJson(this.settingsFile, {});
  }

  // Default is the normal Claude Desktop login. It is always first and cannot be removed.
  all() {
    const d = this.settings.defaultProfile || {};
    const def = {
      id: 'default',
      name: d.name || 'Default',
      email: d.email || '',
      color: d.color || DEFAULT_COLOR,
      dataDir: this.claudeDataDir,
      isDefault: true,
    };
    return [def, ...this.list.map((p) => ({ ...p, isDefault: false }))];
  }

  get(id) {
    return this.all().find((p) => p.id === id) || null;
  }

  // Two accounts with the same name would be impossible to tell apart in the taskbar, and it is what a double-click on
  // Save would create.
  assertNameFree(name, exceptId) {
    const wanted = cleanName(name).toLowerCase();
    if (this.all().some((p) => p.id !== exceptId && p.name.toLowerCase() === wanted)) {
      throw new Error(`An account named “${cleanName(name)}” already exists.`);
    }
  }

  add({ name, color, email }) {
    this.assertNameFree(name);
    const id = crypto.randomUUID();
    const profile = {
      id,
      name: cleanName(name),
      email: cleanEmail(email),
      color: cleanColor(color),
      dataDir: path.join(this.profilesRoot, id),
      createdAt: new Date().toISOString(),
    };
    this.list.push(profile);
    writeJson(this.profilesFile, this.list);
    return profile;
  }

  update(id, { name, color, email }) {
    this.assertNameFree(name, id);
    const patch = { name: cleanName(name), color: cleanColor(color), email: cleanEmail(email) };
    if (id === 'default') {
      this.settings.defaultProfile = patch;
      this.saveSettings();
      return;
    }
    const p = this.list.find((x) => x.id === id);
    if (!p) throw new Error('Account not found.');
    Object.assign(p, patch);
    writeJson(this.profilesFile, this.list);
  }

  // Only ever deletes inside the launcher's own profiles folder.
  remove(id, { deleteData }) {
    const p = this.list.find((x) => x.id === id);
    if (!p) throw new Error('Account not found.');
    this.list = this.list.filter((x) => x.id !== id);
    writeJson(this.profilesFile, this.list);
    if (deleteData) {
      const rel = path.relative(this.profilesRoot, p.dataDir);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        fs.rmSync(p.dataDir, { recursive: true, force: true });
      }
    }
  }

  setSetting(key, value) {
    this.settings[key] = value;
    this.saveSettings();
  }

  saveSettings() {
    writeJson(this.settingsFile, this.settings);
  }

  // Adds accounts from a backup, skipping any name that already exists (case-insensitive). Never overwrites, and
  // an imported account starts with no data folder until it is opened for the first time.
  importAccounts(entries) {
    const existing = new Set(this.all().map((p) => p.name.toLowerCase()));
    const added = [];
    const skipped = [];
    for (const raw of Array.isArray(entries) ? entries : []) {
      let name;
      try {
        name = cleanName(raw && raw.name);
      } catch {
        continue;
      }
      if (existing.has(name.toLowerCase())) {
        skipped.push(name);
        continue;
      }
      try {
        const p = this.add({ name, color: raw.color, email: raw.email });
        existing.add(p.name.toLowerCase());
        added.push(p.name);
      } catch {
        skipped.push(name);
      }
    }
    return { added, skipped };
  }
}

module.exports = { ProfileStore, cleanEmail };
