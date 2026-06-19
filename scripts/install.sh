#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Claude Desktop UI Patcher  —  Linux & macOS
#
# Usage:
#   bash install.sh            # auto-detect Claude installation
#   bash install.sh /path/to/app.asar   # explicit asar path
#
# What it does:
#   1. Finds (or accepts) the path to Claude Desktop's app.asar
#   2. Backs it up as app.asar.bak (first run only)
#   3. Embeds custom-ui.js into the preload (mainView.js) inside the asar
#   4. On first run, also adds Ctrl+Q to quit
#
# Re-run this script whenever you update custom-ui.js.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUSTOM_UI="$SCRIPT_DIR/custom-ui.js"
WORK_DIR="/tmp/claude-ui-patch-$$"

# ── Locate app.asar ──────────────────────────────────────────────────────────
find_asar() {
  local candidates=(
    # macOS
    "/Applications/Claude.app/Contents/Resources/app.asar"
    "$HOME/Applications/Claude.app/Contents/Resources/app.asar"
    # Linux — deb/rpm installs
    "/usr/lib/claude-desktop/resources/app.asar"
    "/usr/share/claude-desktop/resources/app.asar"
    "/opt/claude-desktop/resources/app.asar"
    # Linux — user installs / Flatpak unpacked
    "$HOME/.local/lib/claude-desktop/resources/app.asar"
    "$HOME/.local/share/claude-desktop/resources/app.asar"
  )
  for p in "${candidates[@]}"; do
    if [[ -f "$p" ]]; then echo "$p"; return; fi
  done
  # Fallback: find in common roots
  local found
  found=$(find /opt /usr /Applications "$HOME/.local" "$HOME/Applications" \
    -maxdepth 8 -name "app.asar" -path "*/claude*" 2>/dev/null | head -1)
  echo "$found"
}

if [[ $# -ge 1 ]]; then
  ASAR="$1"
else
  ASAR="$(find_asar)"
fi

if [[ -z "$ASAR" || ! -f "$ASAR" ]]; then
  echo "✗ Could not find Claude Desktop's app.asar."
  echo "  Pass the path explicitly:  bash install.sh /path/to/app.asar"
  exit 1
fi

echo "✓ Found asar: $ASAR"

# ── Dependency check ─────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "✗ Node.js not found. Install it from https://nodejs.org/ and retry."
  exit 1
fi
if ! command -v python3 &>/dev/null; then
  echo "✗ Python 3 not found. Please install Python 3 and retry."
  exit 1
fi

# ── Backup ───────────────────────────────────────────────────────────────────
BAK="${ASAR}.bak"
if [[ ! -f "$BAK" ]]; then
  cp "$ASAR" "$BAK"
  echo "✓ Backup created: $BAK"
else
  echo "✓ Backup already exists: $BAK"
fi

# ── Extract ──────────────────────────────────────────────────────────────────
echo "→ Extracting asar..."
rm -rf "$WORK_DIR"
npx --yes @electron/asar extract "$ASAR" "$WORK_DIR"

# ── Patch mainView.js ────────────────────────────────────────────────────────
echo "→ Patching mainView.js..."
python3 - "$WORK_DIR" "$CUSTOM_UI" << 'PYEOF'
import sys, json, re

work_dir = sys.argv[1]
custom_ui_path = sys.argv[2]
mv_path = work_dir + "/.vite/build/mainView.js"

with open(custom_ui_path) as f:
    code = f.read()
encoded = json.dumps(code)

with open(mv_path) as f:
    mv = f.read()

LOADER_SENTINEL = "// ── custom-ui loader"
CTRLQ_SENTINEL  = "// ── Ctrl+Q to quit"
SOURCEMAP_RE    = r"\n//# sourceMappingURL="

new_loader = (
    "// ── custom-ui loader ──────────────────────────────────────────────────────\n"
    "(function(){try{var _c=" + encoded + ";"
    'require("electron").webFrame.executeJavaScript(_c)'
    '.then(function(){console.log("[custom-ui] ok");})'
    '.catch(function(e){console.error("[custom-ui]",e);}); }'
    'catch(e){console.error("[custom-ui fatal]",e);}})();\n'
)

ctrlq_block = (
    "\n// ── Ctrl+Q to quit ────────────────────────────────────────────────────────\n"
    "document.addEventListener('keydown', function(e){\n"
    "  if(e.ctrlKey && !e.shiftKey && !e.altKey && (e.key==='q'||e.key==='Q')){\n"
    "    try{require('electron').ipcRenderer.send('WindowControl_close');}catch(err){}\n"
    "  }\n"
    "}, true);\n"
)

loader_idx = mv.find(LOADER_SENTINEL)
ctrlq_idx  = mv.find(CTRLQ_SENTINEL)

if loader_idx != -1 and ctrlq_idx != -1:
    # Update run: replace just the loader block, keep Ctrl+Q intact
    mv = mv[:loader_idx] + new_loader + mv[ctrlq_idx:]
    print("  Updated existing loader block.")
elif loader_idx == -1:
    # First-time install: append both blocks before the sourcemap comment
    m = re.search(SOURCEMAP_RE, mv)
    if m:
        insert_at = m.start()
    else:
        insert_at = len(mv)
    mv = mv[:insert_at] + "\n" + new_loader + ctrlq_block + mv[insert_at:]
    print("  First-time install: added loader + Ctrl+Q blocks.")
else:
    # loader exists but no Ctrl+Q — just update the loader
    end = len(mv)
    m = re.search(SOURCEMAP_RE, mv[loader_idx:])
    if m:
        end = loader_idx + m.start()
    mv = mv[:loader_idx] + new_loader + mv[end:]
    print("  Updated loader block (no Ctrl+Q sentinel found).")

with open(mv_path, "w") as f:
    f.write(mv)

print(f"  Embedded {len(code)} bytes of custom-ui.js")
PYEOF

# ── Repack ───────────────────────────────────────────────────────────────────
echo "→ Repacking asar..."
PATCHED="/tmp/claude-ui-patched-$$.asar"
npx @electron/asar pack "$WORK_DIR" "$PATCHED"

# Write back — may need sudo on macOS if in /Applications
if cp "$PATCHED" "$ASAR" 2>/dev/null; then
  echo "✓ Done. Restart Claude Desktop to apply changes."
else
  echo "→ Need elevated permissions to write to $ASAR ..."
  sudo cp "$PATCHED" "$ASAR"
  echo "✓ Done. Restart Claude Desktop to apply changes."
fi

# Cleanup
rm -rf "$WORK_DIR" "$PATCHED"
