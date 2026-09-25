# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead: open the
repository's **Security** tab and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and the launcher and Windows versions. You will get a reply as soon as
the maintainers can, and a fix is released as a new version.

## Supported versions

Only the latest release receives fixes.

## What the launcher can and cannot do

Knowing the scope helps when judging a report:

- It runs as the current Windows user and needs no administrator rights.
- It reads the process list and command lines, Claude's own log files, and (only on request) one Claude settings file.
- It does not read, decrypt or send sign-in tokens or cookies, and it makes no network requests of its own.
- It starts Claude Desktop with different data folders, and changes the icon, title and taskbar identity of the windows
  it opened. It never modifies, closes or restyles the Default Claude.
- Sign-in links pass through it in memory only. The one-time code in a link is never written to a log.

## About the downloads

Release files are **not code-signed**. Check the SHA-256 listed in `SHA256SUMS.txt` on the release page against the
file you downloaded, and only download from this repository's Releases page.
