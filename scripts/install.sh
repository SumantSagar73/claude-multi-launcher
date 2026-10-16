#!/usr/bin/env bash
# Installs the packaged launcher for the current Linux user. Nothing outside your home folder is touched, no sudo needed.
#   npm run package:linux
#   npm run install-app:linux
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="${1:-$here/../dist/Claude Multi Launcher-linux-x64}"
name="Claude Multi Launcher"
dest="${XDG_DATA_HOME:-$HOME/.local/share}/claude-multi-launcher"
bin_dir="$HOME/.local/bin"
apps_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
icon_dir="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps"

if [ ! -d "$src" ]; then
  echo "Nothing to install at $src. Run 'npm run package:linux' first." >&2
  exit 1
fi

# Close a running installed copy so its files can be replaced. Only this launcher; never Claude itself.
if [ -x "$dest/$name" ]; then
  for pid in $(pgrep -f "^$dest/$name" || true); do kill "$pid" 2>/dev/null || true; done
  sleep 1
fi

mkdir -p "$dest" "$bin_dir" "$apps_dir" "$icon_dir"
rm -rf "$dest"
mkdir -p "$dest"
cp -a "$src/." "$dest/"
cp "$here/../build/icon.png" "$icon_dir/claude-multi-launcher.png" 2>/dev/null || true

# A user-level install cannot give Electron's sandbox helper the setuid bit, and many systems (Ubuntu 24.04 among them)
# block the alternative. The launcher only ever shows its own local window, never web pages, so it runs with --no-sandbox.
# Use the .deb or AppImage from the releases page if you would rather have the sandbox.
cat > "$bin_dir/claude-multi-launcher" <<LAUNCH
#!/bin/sh
exec "$dest/$name" --no-sandbox "\$@"
LAUNCH
chmod +x "$bin_dir/claude-multi-launcher"

cat > "$apps_dir/claude-multi-launcher.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=$name
Comment=Several Claude Desktop accounts side by side
Exec="$dest/$name" --no-sandbox
Icon=claude-multi-launcher
Terminal=false
Categories=Network;Utility;
StartupWMClass=claude-multi-launcher
DESKTOP

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps_dir" || true

echo "Installed to $dest"
echo "Command: $bin_dir/claude-multi-launcher (make sure $bin_dir is on your PATH)"
echo "Application menu entry: $apps_dir/claude-multi-launcher.desktop"
echo "Turn on 'Start at login' inside the app if you want it when you sign in."
