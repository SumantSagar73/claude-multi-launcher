'use strict';

const { execFile } = require('node:child_process');

// A run building this launcher once left registry entries (HKCU only) that made Windows show an "Open with" prompt
// for every claude:// link instead of opening Claude. This detects that specific leftover and can remove it. It
// never touches HKCU\Software\Classes\claude\shell\open\command, which is Claude's own registration.
const PROGID = 'ClaudeMultiLauncher.URL';
const APP_NAME = 'Claude Multi Launcher';
const KEYS = {
  progid: `HKCU\\Software\\Classes\\${PROGID}`,
  capabilities: 'HKCU\\Software\\ClaudeMultiLauncher',
  openWith: 'HKCU\\Software\\Classes\\claude\\OpenWithProgids',
  registeredApps: 'HKCU\\Software\\RegisteredApplications',
};

function reg(args) {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout) => resolve({ ok: !err, stdout: stdout || '' }));
  });
}

async function keyExists(key) {
  return (await reg(['query', key])).ok;
}

async function valueExists(key, name) {
  return (await reg(['query', key, '/v', name])).ok;
}

async function findLeftovers() {
  const [progid, caps, openWith, registered] = await Promise.all([
    keyExists(KEYS.progid),
    keyExists(KEYS.capabilities),
    valueExists(KEYS.openWith, PROGID),
    valueExists(KEYS.registeredApps, APP_NAME),
  ]);
  const found = [];
  if (progid) found.push('progid');
  if (caps) found.push('capabilities');
  if (openWith) found.push('openWith');
  if (registered) found.push('registeredApps');
  return found;
}

async function removeLeftovers() {
  await Promise.all([
    reg(['delete', KEYS.openWith, '/v', PROGID, '/f']),
    reg(['delete', KEYS.registeredApps, '/v', APP_NAME, '/f']),
    reg(['delete', KEYS.capabilities, '/f']),
    reg(['delete', KEYS.progid, '/f']),
  ]);
}

module.exports = { findLeftovers, removeLeftovers };
