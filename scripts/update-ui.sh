#!/usr/bin/env bash
# Re-bakes ~/.config/Claude/custom-ui.js into the Claude Desktop asar.
# Run after editing custom-ui.js, then restart Claude Desktop.
set -e

CUSTOM="$HOME/.config/Claude/custom-ui.js"
ASAR="$HOME/.local/lib/claude-desktop-patched/usr/lib/node_modules/electron/dist/resources/app.asar"
EXTRACT="/tmp/claude-ui-work"

echo "→ Extracting asar..."
rm -rf "$EXTRACT"
npx --yes @electron/asar extract "$ASAR" "$EXTRACT"

echo "→ Embedding custom-ui.js..."
python3 << PYEOF
import json, os

AI_DIR = os.path.expanduser("~/Documents/AI Projects")
try:
    entries = sorted(e for e in os.listdir(AI_DIR)
                     if os.path.isdir(os.path.join(AI_DIR, e)) and not e.startswith('.'))
    ai_list = [os.path.join(AI_DIR, e) for e in entries]
except Exception:
    ai_list = []

# ── Write cc-folders.json so the preload can re-read it at runtime
#    (no asar repack needed after a rename — just run refresh-folders.sh)
folders_json = os.path.expanduser("~/.config/Claude/cc-folders.json")
with open(folders_json, "w") as f:
    json.dump(ai_list, f)
print(f"  Wrote {len(ai_list)} folders to cc-folders.json")

# ── Bake each folder's TODO.md content (snapshot at build time).
#    The renderer + preload are both sandboxed (no fs), so the only way to
#    show a folder's TODO.md is to embed its text here. Keyed by full path.
todos = {}
for path in ai_list:
    todo_path = os.path.join(path, "TODO.md")
    if os.path.isfile(todo_path):
        try:
            with open(todo_path, encoding="utf-8") as tf:
                todos[path] = tf.read()[:4000]
        except Exception:
            pass
print(f"  Baked {len(todos)} TODO.md previews")

with open("$CUSTOM") as f:
    code = f.read()

# Bake CC_AI_LOCAL as a build-time fallback (in case cc-folders.json is missing)
code = ("const CC_AI_TODOS=" + json.dumps(todos) + ";\n"
        + "const CC_AI_LOCAL=" + json.dumps(ai_list) + ";\n" + code)
encoded = json.dumps(code)

mv_path = "$EXTRACT/.vite/build/mainView.js"
with open(mv_path) as f:
    mv = f.read()

idx = mv.find("// ── custom-ui loader")
# Stop just before the Ctrl+Q patch — don't overwrite it
end_marker = "\n// ── Ctrl+Q to quit"
end_idx = mv.find(end_marker, idx)

if idx == -1 or end_idx == -1:
    raise RuntimeError(
        "custom-ui loader sentinel or Ctrl+Q sentinel not found in mainView.js.\n"
        "Was the asar patched with both blocks? Check mainView.js manually."
    )

# IMPORTANT: the mainView preload is SANDBOXED (Electron defaults: sandbox:true,
# contextIsolation:true). That means require('fs') / require('os') are NOT
# available here — calling them throws and, if not caught, kills the whole loader.
# Only require('electron') is available. So we:
#   1. bake the folder list into the custom-ui code as CC_AI_LOCAL (done above),
#   2. inject via webFrame.executeJavaScript so the code runs in the page MAIN
#      world (DOM + localStorage), exactly like the WCO topbar shim above.
# Folder renames are picked up by re-running update-ui.sh (re-bakes CC_AI_LOCAL).
new_loader = (
    "// ── custom-ui loader ──────────────────────────────────────────────────────\n"
    "(function(){try{"
    "var _wf=require('electron').webFrame;"
    "var _c=" + encoded + ";"
    "function _inject(){_wf.executeJavaScript(_c).then(function(){console.log('[custom-ui] ok');}).catch(function(e){console.error('[custom-ui]',e);});}"
    "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',_inject,{once:true});}else{_inject();} }"
    "catch(e){try{console.error(\"[custom-ui fatal]\",e);}catch(_){}}})();\n"
)

with open(mv_path, "w") as f:
    f.write(mv[:idx] + new_loader + mv[end_idx:])

print(f"  Embedded {len(code)} bytes of custom-ui.js")
PYEOF

echo "→ Repacking asar..."
npx @electron/asar pack "$EXTRACT" /tmp/claude-ui-patched.asar
cp /tmp/claude-ui-patched.asar "$ASAR"

echo "✓ Done. Restart Claude Desktop to apply changes."
