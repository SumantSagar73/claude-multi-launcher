'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/router');
const { parseUserDataDir } = require('../src/claude');

const profiles = [
  { id: 'default', isDefault: true, name: 'Default' },
  { id: 'a', name: 'Account A' },
  { id: 'b', name: 'Account B' },
];
const NOW = 1_000_000_000_000;
const base = () => ({ profiles, running: new Set(), hints: new Map(), lastLaunched: new Map(), now: NOW });

test('classifies sign-in callbacks vs other links', () => {
  assert.equal(r.isLoginCallback('claude://login/google-auth?code=1&state=2'), true);
  assert.equal(r.isLoginCallback('claude://claude.ai/magic-link#abc'), true);
  assert.equal(r.isLoginCallback('claude://claude.ai/sso-callback?x=1'), true);
  assert.equal(r.isLoginCallback('claude://claude.ai/chat/123'), false);
  assert.equal(r.isLoginCallback('claude://claude.ai/mcp-auth-callback?code=1'), false);
  assert.equal(r.isLoginCallback('https://claude.ai/login'), false);
  assert.equal(r.isLoginCallback(undefined), false);
});

test('describeUrl never leaks query or fragment', () => {
  const d = r.describeUrl('claude://login/google-auth?code=SECRET&state=SECRET2#frag');
  assert.equal(d, 'login/google-auth');
  assert.ok(!/SECRET|frag/.test(d));
});

test('extractClaudeUrl pulls the link out of a process command line', () => {
  const cmd = '"C:\Program Files\WindowsApps\Claude_1\app\Claude.exe" "claude://login/google-auth?code=a&state=b"';
  assert.equal(r.extractClaudeUrl(cmd), 'claude://login/google-auth?code=a&state=b');
  assert.equal(r.extractClaudeUrl('claude.exe --type=renderer'), null);
  assert.equal(r.extractClaudeUrl(undefined), null);
});

test('login goes to the profile that opened the sign-in page most recently', () => {
  const c = base();
  c.running = new Set(['default', 'a', 'b']);
  c.hints = new Map([['a', NOW - 60_000], ['b', NOW - 5_000]]);
  assert.equal(r.chooseLoginTarget(c).id, 'b');
});

test('stale or not-running hints are ignored', () => {
  const c = base();
  c.running = new Set(['default', 'a']);
  c.hints = new Map([['a', NOW - r.LOGIN_HINT_TTL_MS - 1], ['b', NOW - 1000]]); // b is not running
  assert.equal(r.chooseLoginTarget(c).id, 'default');
});

test('falls back to the most recently opened running non-default profile', () => {
  const c = base();
  c.running = new Set(['default', 'a', 'b']);
  c.lastLaunched = new Map([['default', NOW - 1], ['a', NOW - 9000], ['b', NOW - 4000]]);
  const t = r.chooseLoginTarget(c);
  assert.equal(t.id, 'b');
  assert.match(t.reason, /recently opened/);
});

test('falls back to Default when nothing else applies', () => {
  assert.equal(r.chooseLoginTarget(base()).id, 'default');
});

test('matchProfileArg resolves an --open value to exactly one profile or none', () => {
  assert.equal(r.matchProfileArg(profiles, 'a').id, 'a');
  assert.equal(r.matchProfileArg(profiles, 'DEFAULT').id, 'default');
  assert.equal(r.matchProfileArg(profiles, 'nope'), null);
  assert.equal(r.matchProfileArg(profiles, ''), null);
  // an ambiguous prefix (matches more than one name, and none exactly) must not guess
  const withPrefixClash = [{ id: 'x', name: 'Work' }, { id: 'y', name: 'Work Two' }];
  assert.equal(r.matchProfileArg(withPrefixClash, 'wor'), null);
  assert.equal(r.matchProfileArg(withPrefixClash, 'Work').id, 'x'); // exact case-insensitive name still wins
});

test('parseUserDataDir handles every way the folder can be quoted', () => {
  const exe = String.raw`"C:\Program Files\WindowsApps\Claude_1pp\Claude.exe"`;
  // Node quotes the whole argument when the path contains a space.
  assert.equal(
    parseUserDataDir(`${exe} "--user-data-dir=C:\Users\me\AppData\Roaming\Claude Multi Launcher\profiles\abc"`),
    'C:\Users\me\AppData\Roaming\Claude Multi Launcher\profiles\abc',
  );
  // Only the value quoted.
  assert.equal(parseUserDataDir(`${exe} --user-data-dir="D:\a b\p"`), 'D:\a b\p');
  // Bare.
  assert.equal(parseUserDataDir(`${exe} --user-data-dir=D:\proj\p --type=gpu-process`), 'D:\proj\p');
  // The Default account is started with no such flag.
  assert.equal(parseUserDataDir(exe), null);
  assert.equal(parseUserDataDir(undefined), null);
});
