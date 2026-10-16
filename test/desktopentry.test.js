'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const de = require('../src/desktopentry');

test('execArg leaves plain words alone and quotes anything the spec says to quote', () => {
  assert.equal(de.execArg('/usr/bin/app'), '/usr/bin/app');
  assert.equal(de.execArg('--open=Work'), '--open=Work');
  assert.equal(de.execArg('--open=My Work'), '"--open=My Work"');
  assert.equal(de.execArg('say "hi"'), '"say \\"hi\\""');
  assert.equal(de.execArg('a$b'), '"a\\$b"');
  assert.equal(de.execArg('100%'), '100%%'); // % starts a field code, so it is doubled
});

test('buildDesktopEntry writes a valid, single-line-per-key entry', () => {
  const text = de.buildDesktopEntry({
    name: 'Claude (Work)\nExec=evil',
    exec: ['/opt/Claude Multi/launcher', '--open=Work Acct'],
    icon: '/home/u/.config/x/icons/a.png',
    wmClass: 'claude-multi-abc',
  });
  const lines = text.trimEnd().split('\n');
  assert.equal(lines[0], '[Desktop Entry]');
  assert.ok(lines.includes('Name=Claude (Work) Exec=evil')); // a newline in a name cannot add a key
  assert.ok(lines.includes('Exec="/opt/Claude Multi/launcher" "--open=Work Acct"'));
  assert.ok(lines.includes('StartupWMClass=claude-multi-abc'));
  assert.equal(lines.filter((l) => l.startsWith('Exec=')).length, 1);
});

test('autostart entry is created and removed under XDG_CONFIG_HOME', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cml-xdg-'));
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  try {
    assert.equal(de.isAutostartOn(), false);
    de.setAutostart(true, { exec: ['/x/launcher', '--hidden'], icon: '/x/i.png' });
    assert.equal(de.isAutostartOn(), true);
    assert.match(fs.readFileSync(path.join(dir, 'autostart', 'claude-multi-launcher.desktop'), 'utf8'), /Exec=\/x\/launcher --hidden/);
    de.setAutostart(false, {});
    assert.equal(de.isAutostartOn(), false);
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
});

test('account entry names follow the id, so a rename never orphans a file', () => {
  assert.equal(de.accountEntryName({ id: 'AB-12-cd' }), 'claude-multi-ab12cd');
});
