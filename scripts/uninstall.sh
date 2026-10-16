#!/usr/bin/env bash
# Removes what scripts/install.sh added. Your accounts (~/.config/Claude Multi Launcher) are kept, so a reinstall picks
# them up again, and your normal Claude data is never touched.
set -euo pipefail

data="${XDG_DATA_HOME:-$HOME/.local/share}"
config="${XDG_CONFIG_HOME:-$HOME/.config}"
dest="$data/claude-multi-launcher"
name="Claude Multi Launcher"

if [ -x "$dest/$name" ]; then
  for pid in $(pgrep -f "^$dest/$name" || true); do kill "$pid" 2>/dev/null || true; done
fi

rm -rf "$dest"
rm -f "$HOME/.local/bin/claude-multi-launcher" \
      "$data/applications/claude-multi-launcher.desktop" \
      "$data/icons/hicolor/512x512/apps/claude-multi-launcher.png" \
      "$config/autostart/claude-multi-launcher.desktop"
# Per-account app launcher entries made with the shortcut button
rm -f "$data"/applications/claude-multi-*.desktop

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$data/applications" || true
echo "Removed the launcher. Accounts in $config/$name were left in place."
