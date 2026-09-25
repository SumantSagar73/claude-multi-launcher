'use strict';

// Pure decision logic for where a claude:// link should go. No I/O here so it can be unit-tested.

const LOGIN_HINT_TTL_MS = 15 * 60 * 1000;
const RECENT_LAUNCH_TTL_MS = 30 * 60 * 1000;

// Deep-link shapes taken from Claude Desktop's own URL handler:
//   claude://login/google-auth?code=…&state=…      Google sign-in
//   claude://claude.ai/magic-link…                 e-mail sign-in
//   claude://claude.ai/sso-callback…               SSO sign-in
function parseClaudeUrl(raw) {
  if (typeof raw !== 'string') return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'claude:') return null;
  return { host: u.hostname.toLowerCase(), segments: u.pathname.split('/').filter(Boolean) };
}

function isLoginCallback(raw) {
  const p = parseClaudeUrl(raw);
  if (!p) return false;
  if (p.host === 'login') return true;
  return p.host === 'claude.ai' && ['magic-link', 'sso-callback'].includes(p.segments[0]);
}

// Host and path only. Query strings and fragments carry one-time codes, so they never reach the activity log.
function describeUrl(raw) {
  const p = parseClaudeUrl(raw);
  if (!p) return 'unrecognised link';
  return [p.host, ...p.segments].join('/').slice(0, 60);
}

// The link Windows passes to Claude appears on that process's command line, quoted.
function extractClaudeUrl(commandLine) {
  const m = /"?(claude:\/\/[^"\s]+)"?/i.exec(commandLine || '');
  return m ? m[1] : null;
}

/**
 * A sign-in callback only works in the app instance that started that sign-in (Claude checks a state
 * value), so pick the profile that most plausibly started it.
 *   1. a running profile whose log shows it opened the sign-in page most recently
 *   2. else the running non-default profile the launcher opened most recently
 *   3. else Default
 */
function chooseLoginTarget({ profiles, running, hints, lastLaunched, now }) {
  const isRunning = (id) => running.has(id);

  let best = null;
  for (const p of profiles) {
    const t = hints.get(p.id);
    if (!isRunning(p.id) || !t || now - t > LOGIN_HINT_TTL_MS) continue;
    if (!best || t > best.t) best = { id: p.id, t };
  }
  if (best) {
    const secs = Math.max(0, Math.round((now - best.t) / 1000));
    return { id: best.id, reason: `started sign-in ${secs}s ago` };
  }

  let recent = null;
  for (const p of profiles) {
    const t = lastLaunched.get(p.id);
    if (p.isDefault || !isRunning(p.id) || !t || now - t > RECENT_LAUNCH_TTL_MS) continue;
    if (!recent || t > recent.t) recent = { id: p.id, t };
  }
  if (recent) return { id: recent.id, reason: 'most recently opened account' };

  return { id: 'default', reason: 'no sign-in in progress' };
}

// Matches a --open=<value> command-line argument (used by per-account shortcuts and hotkeys) to a profile: exact id,
// then exact name, then a name that starts with the text, case-insensitive throughout. Null if nothing or too much matches.
function matchProfileArg(profiles, arg) {
  const text = String(arg ?? '').trim().toLowerCase();
  if (!text) return null;
  const byId = profiles.find((p) => p.id.toLowerCase() === text);
  if (byId) return byId;
  const byName = profiles.filter((p) => p.name.toLowerCase() === text);
  if (byName.length === 1) return byName[0];
  const byPrefix = profiles.filter((p) => p.name.toLowerCase().startsWith(text));
  return byPrefix.length === 1 ? byPrefix[0] : null;
}

module.exports = {
  LOGIN_HINT_TTL_MS,
  RECENT_LAUNCH_TTL_MS,
  parseClaudeUrl,
  isLoginCallback,
  describeUrl,
  extractClaudeUrl,
  chooseLoginTarget,
  matchProfileArg,
};
