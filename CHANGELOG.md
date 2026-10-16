# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Linux support (Ubuntu 22.04+ / Debian 12+, with the `claude-desktop` package): list, open, focus and quit accounts,
  sign-in routing by watching `/proc`, per-account app-menu entries (`.desktop`) with their own window class and icon,
  start at login, tray menu, hotkeys on X11, per-account memory measured as PSS.
- Tiling and idle-close on X11 sessions with `xdotool`; switched off on Wayland.
- AppImage, `.deb` and `.tar.gz` builds (`npm run release` on Linux), and `npm run package:linux` /
  `npm run install-app:linux` for a per-user install without sudo.
- Support for the community Snap Store app `claude-ai-desktop`: found automatically, its processes matched by snap
  folder, and accounts kept under `~/snap/claude-ai-desktop/common` because the snap sandbox blocks hidden folders.
- Linux: **Catch sign-in links** setting. It makes the launcher the system handler for `claude://` links, routes each
  sign-in to the account that began it, hands other links to the Default Claude, and puts the previous handler back
  when switched off.
- Linux: when nothing says which account began a sign-in, the account that started most recently is used (also after
  the launcher itself was restarted).
- The installed `claude-multi-launcher` command now starts in the background instead of holding the terminal.
- `CML_CLAUDE_PATH` and `CML_CLAUDE_DATA` to point the launcher at an unusual Claude Desktop install.

### Changed
- Settings and buttons that a system cannot support are hidden instead of failing (for example "Free memory" on Linux).
- Idle-close now keeps track of which account is in front even when "Free memory" is turned off.

### Known limitations
- Linux: freeing memory from idle accounts is not available, and window titles are not prefixed with the account name.

## [1.0.0] - 2026-09-25

First public release.

### Added
- Run several Claude Desktop accounts side by side, each with its own data folder; the normal Claude stays as *Default*.
- Sign-in routing: a browser sign-in for a second account is passed to the window that started it.
- Per-account window identity: own taskbar button, coloured icon with the account's initial, `[Name]` title prefix.
- Global hotkeys `Ctrl+Alt+0` to `Ctrl+Alt+9`, per-account Start Menu shortcuts, and one-click window tiling.
- Memory: idle accounts give their memory back; optional auto-close after a chosen number of idle hours.
- Per-account RAM and disk use, including the Cowork VM image.
- Copy MCP server settings from another account when adding one.
- Export and import of the account list (names, colours and emails only).
- Health check, copyable errors and a "copy diagnostics" button.
- Notice in *Activity* when Claude Desktop updates itself while an account is open.
- One-click per-user Windows installer and a portable zip.

### Known limitations
- Windows 10/11 x64 and the Microsoft Store version of Claude Desktop only.
- Builds are unsigned, so Windows SmartScreen may warn on first run.

[Unreleased]: https://github.com/SumantSagar73/claude-multi-launcher/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/SumantSagar73/claude-multi-launcher/releases/tag/v1.0.0
