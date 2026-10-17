'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lh = require('../src/linkhandler');
const de = require('../src/desktopentry');

test('findHandlerEntries lists entries that open claude:// links and skips our own', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cml-apps-'));
  fs.writeFileSync(path.join(dir, 'claude-desktop.desktop'), '[Desktop Entry]\nName=Claude\nMimeType=x-scheme-handler/claude;\n');
  fs.writeFileSync(path.join(dir, 'other.desktop'), '[Desktop Entry]\nMimeType=text/plain;\n');
  fs.writeFileSync(path.join(dir, lh.ENTRY), '[Desktop Entry]\nMimeType=x-scheme-handler/claude;\n');
  assert.deepEqual(lh.findHandlerEntries([dir, '/nonexistent']), ['claude-desktop.desktop']);
});

test('the link handler entry keeps %u as a field code and quotes the program path', () => {
  const text = de.buildDesktopEntry({
    name: 'x',
    exec: ['/opt/Claude Multi/launcher', '--no-sandbox'],
    fieldCode: '%u',
    extra: { MimeType: 'x-scheme-handler/claude;', NoDisplay: 'true' },
  });
  assert.ok(text.split('\n').includes('Exec="/opt/Claude Multi/launcher" --no-sandbox %u'));
  assert.ok(text.includes('MimeType=x-scheme-handler/claude;'));
  assert.ok(text.includes('NoDisplay=true'));
});
