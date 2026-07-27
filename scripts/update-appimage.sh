#!/usr/bin/env bash
# Updates the claude-desktop-appimage AUR package (if a newer version is
# available), replaces the patched app directory with the fresh extract, and
# re-runs update-ui.sh to re-bake our custom UI on top of it.
#
# Safe to run any time: no-ops (skips the wholesale replace) if the AUR
# package is already current, but still re-runs update-ui.sh so local edits
# to custom-ui/ get picked up.
set -e

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PATCHED_ROOT="$HOME/.local/lib/claude-desktop-patched"

echo "→ Checking installed AppImage package version..."
BEFORE="$(pacman -Q claude-desktop-appimage 2>/dev/null | awk '{print $2}')"
echo "  Currently installed: ${BEFORE:-<not installed>}"

echo "→ Syncing claude-desktop-appimage via yay (sudo required)..."
yay -S --noconfirm claude-desktop-appimage

AFTER="$(pacman -Q claude-desktop-appimage 2>/dev/null | awk '{print $2}')"
echo "  Now installed: ${AFTER:-<not installed>}"

if [[ "$BEFORE" == "$AFTER" ]]; then
  echo "→ Package unchanged. Skipping wholesale re-extract."
else
  echo "→ New version detected ($BEFORE -> $AFTER). Re-extracting AppImage..."
  cd /tmp && rm -rf squashfs-root
  /opt/claude-desktop/claude-desktop.AppImage --appimage-extract >/dev/null

  ASAR_REL="$(cd squashfs-root && find . -iname app.asar | head -1)"
  if [[ -z "$ASAR_REL" ]]; then
    echo "ERROR: could not find app.asar in extracted AppImage" >&2
    exit 1
  fi
  echo "  Found asar at: $ASAR_REL"

  BACKUP="$PATCHED_ROOT.bak-$(date +%Y%m%d-%H%M%S)"
  echo "→ Backing up current patched dir to $BACKUP"
  cp -a "$PATCHED_ROOT" "$BACKUP"

  echo "→ Replacing patched app directory with fresh extract..."
  rm -rf "$PATCHED_ROOT"
  cp -a /tmp/squashfs-root "$PATCHED_ROOT"
fi

echo "→ Re-baking custom UI onto the (possibly fresh) app..."
"$SCRIPT_DIR/update-ui.sh"

echo "✓ Done. Fully quit and relaunch Claude Desktop to pick up the changes."
