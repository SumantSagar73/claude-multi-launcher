# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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

[1.0.0]: https://github.com/SumantSagar73/claude-multi-launcher/releases/tag/v1.0.0
