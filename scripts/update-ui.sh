#!/usr/bin/env bash
# Re-bakes custom-ui/ modules into the Claude Desktop asar.
# Edit files in custom-ui/, run this script, then restart Claude Desktop.
#
# v3.0.0-rebase note (2026-07-12): aaddrick's packager switched to repackaging
# Anthropic's official Linux Electron build. Layout changed:
#   - asar moved from usr/lib/node_modules/electron/dist/resources/app.asar
#     to usr/lib/claude-desktop/resources/app.asar
#   - main-process code is no longer .vite/build/index.js; it's a
#     content-hashed chunk (e.g. index.chunk-CNXUb5h4.js) that changes name
#     on every release. We locate it by content signature instead of by name.
#   - the old WCO/frame-fix JS shim is gone; the official build handles the
#     window frame natively, so mainView.js no longer needs that patch.
#   - IPC channel names embed a per-build UUID
#     ($eipc_message$_<uuid>_$_...) — extracted dynamically from mainView.js.
set -e

# Resolve the project dir regardless of whether this script is called via symlink.
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODULES_DIR="$PROJECT_DIR/custom-ui"

# Build combined custom-ui.js from individual module files.
echo "→ Building custom-ui.js from modules..."
{
  printf '/**\n * Claude Desktop custom UI — v17\n * Generated from custom-ui/ modules by update-ui.sh — do not edit directly.\n */\n'
  printf '(function () {\n'"'"'use strict'"'"';\n\n'
  cat "$MODULES_DIR/css.js"
  printf '\n'
  cat "$MODULES_DIR/workspace.js"
  printf '\n'
  cat "$MODULES_DIR/titlewatch.js"
  printf '\n'
  cat "$MODULES_DIR/bootstrap.js"
  printf '\n})();\n'
} > "$PROJECT_DIR/custom-ui.js"
echo "  $(wc -l < "$PROJECT_DIR/custom-ui.js") lines built"

CUSTOM="$PROJECT_DIR/custom-ui.js"
PATCHED_ROOT="$HOME/.local/lib/claude-desktop-patched"
ASAR="$PATCHED_ROOT/usr/lib/claude-desktop/resources/app.asar"
EXTRACT="/tmp/claude-ui-work"

if [[ ! -f "$ASAR" ]]; then
  echo "ERROR: asar not found at $ASAR" >&2
  echo "  (expected new v3.0.0-rebase layout — usr/lib/claude-desktop/resources/app.asar)" >&2
  exit 1
fi

echo "→ Extracting asar..."
rm -rf "$EXTRACT"
npx --yes @electron/asar extract "$ASAR" "$EXTRACT"

# Locate the main-process bundle by content signature rather than filename —
# the vite build hashes chunk filenames and they change every release.
MAIN_BUNDLE="$(grep -lF '_$_FileSystem_$_browseFolder' "$EXTRACT"/.vite/build/*.js | head -1)"
if [[ -z "$MAIN_BUNDLE" ]]; then
  echo "ERROR: could not locate main-process bundle (FileSystem_\$_browseFolder marker not found)" >&2
  exit 1
fi
echo "  Main-process bundle: $(basename "$MAIN_BUNDLE")"

echo "→ Embedding custom-ui.js..."
python3 << PYEOF
import json, os, re

AI_DIR = os.path.expanduser("~/Documents/AI Projects")
try:
    entries = sorted(e for e in os.listdir(AI_DIR)
                     if os.path.isdir(os.path.join(AI_DIR, e))
                     and not e.startswith('.')
                     and not e.startswith('Archived'))
    # AI Projects itself goes first, so it's selectable as a workspace too.
    ai_list = [AI_DIR] + [os.path.join(AI_DIR, e) for e in entries]
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

# ── Extract this build's eipc UUID from mainView.js so the Ctrl+Q handler
#    invokes the right channel. The UUID changes every release; the
#    "claude.web_DOLLAR_WindowControl_DOLLAR_close" suffix has been stable
#    across the 2.1.x and 3.x lines observed so far.
# (Built via chr(36) rather than a literal "\$" in this source file — the
#  bash heredoc here is unquoted, so a literal $ would trigger bash variable
#  expansion, and getting the backslash-escaping right for both a *regex*
#  meta-dollar and a *plain-string* dollar in the same heredoc is error-prone.
#  chr(36) sidesteps both.)
D = chr(36)
uuid_re = re.compile(re.escape(D) + r'eipc_message' + re.escape(D) + r'_([0-9a-fA-F-]+)_' + re.escape(D) + r'_')
m = uuid_re.search(mv)
if not m:
    raise RuntimeError("Could not find eipc UUID in mainView.js — Ctrl+Q channel unknown")
eipc_uuid = m.group(1)
close_channel = D + "eipc_message" + D + "_" + eipc_uuid + "_" + D + "_claude.web_" + D + "_WindowControl_" + D + "_close"
print(f"  eipc UUID: {eipc_uuid}")

idx = mv.find("// ── custom-ui loader")

expose = (
    "try{_cb.exposeInMainWorld('ccBridge',{"
    "armFolder:function(p){return _ipc.invoke('cc-arm-folder',p);},"
    "openFolder:function(p){return _ipc.invoke('cc-open-folder',p);}"
    "});}catch(_){}"
)

new_loader = (
    "// ── custom-ui loader ──────────────────────────────────────────────────────\n"
    "(function(){try{"
    "var _e=require('electron');var _wf=_e.webFrame,_ipc=_e.ipcRenderer,_cb=_e.contextBridge;"
    + expose +
    "var _c=" + encoded + ";"
    "function _run(pre){return _wf.executeJavaScript(pre+_c)"
    ".then(function(){console.log('[custom-ui] ok');})"
    ".catch(function(e){console.error('[custom-ui]',e);});}"
    "function _inject(){_ipc.invoke('cc-ai-data-v2').then(function(d){d=d||{};"
    "var pre='try{window.__CC_TODOS__='+JSON.stringify(d.todos||{})+';'"
    "+'window.__CC_FOLDERS__='+JSON.stringify(d.folders||[])+';}catch(e){}';"
    "return _run(pre);}).catch(function(){return _run('');});}"
    "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',_inject,{once:true});}else{_inject();} }"
    "catch(e){try{console.error(\"[custom-ui fatal]\",e);}catch(_){}}})();\n"
)

ctrlq_block = (
    "\n// ── Ctrl+Q to quit ──────────────────────────────────────────────────────\n"
    "(function(){var _ir=require(\"electron\").ipcRenderer;document.addEventListener(\"keydown\",function(e){"
    "if(e.ctrlKey&&!e.shiftKey&&!e.altKey&&e.key===\"q\"){e.preventDefault();e.stopPropagation();"
    "_ir.invoke(\"" + close_channel + "\");}},true);})();\n"
)

# Both branches replace everything from the start of our block through the
# trailing sourceMappingURL comment (or EOF) — NOT just up to the end_marker
# text, which would leave the old block's function body dangling behind the
# newly-inserted one (produces a corrupt duplicate — caught by node --check
# below, but better to not generate it).
smu_idx = mv.rfind("//# sourceMappingURL")
tail_at = smu_idx if smu_idx != -1 else len(mv)

if idx == -1:
    mv = mv[:tail_at] + new_loader + ctrlq_block + "\n" + mv[tail_at:]
    print("  Bootstrapped custom-ui loader + Ctrl+Q handler (fresh asar)")
else:
    mv = mv[:idx] + new_loader + ctrlq_block + "\n" + mv[tail_at:]
    print("  Re-spliced custom-ui loader + Ctrl+Q handler")

with open(mv_path, "w") as f:
    f.write(mv)

print(f"  Embedded {len(code)} bytes of custom-ui.js")

# ── Patch the native "open project folder" dialog (browseFolder in the main
#    process) so it defaults to ~/Documents/AI Projects instead of $HOME.
#    Located by content signature (see MAIN_BUNDLE above); filename varies
#    per release. Idempotent: once patched the needle pattern won't re-match
#    the original form, so re-runs are no-ops on an already-patched bundle; a
#    fresh extract reintroduces the original code and gets re-patched.
main_path = "$MAIN_BUNDLE"
with open(main_path) as f:
    ix = f.read()

ix_changed = False

# defaultPath:<var>??<homedirExpr>.homedir()  — homedirExpr may be a bare
# identifier ("s") or a member/import alias ("\$t"); handle both.
defaultpath_pattern = re.compile(r'defaultPath:(\w+)\?\?(\\\$?\w+)\.homedir\(\)')
def _defaultpath_repl(m):
    var, homedir_expr = m.group(1), m.group(2)
    return f'defaultPath:{var}??({homedir_expr}.homedir()+"/Documents/AI Projects")'
ix, n = defaultpath_pattern.subn(_defaultpath_repl, ix)
if n:
    ix_changed = True
    print(f"  Patched folder-picker defaultPath in main bundle ({n} site(s))")
else:
    print("  Main bundle folder-picker defaultPath already patched or not found")

# ── Append a self-contained ipcMain handler that reads ~/Documents/AI Projects
#    live at runtime: folder list + each folder's TODO.md. The renderer invokes
#    this via 'cc-ai-data-v2' on every page load, so renames/edits show up WITHOUT
#    re-running this script. Main process has full fs access (unlike the preload).
#    Idempotent: guarded by the channel name so re-runs don't duplicate it.
if "cc-ai-data-v2" not in ix:
    handler = (
        ";(function(){try{var _e=require('electron'),fs=require('fs'),"
        "p=require('path'),os=require('os');"
        "var AI=p.join(os.homedir(),'Documents','AI Projects');"
        "_e.ipcMain.handle('cc-ai-data-v2',function(){"
        "var out={folders:[],todos:{}};try{"
        "out.folders.push(AI);"
        "try{var atd=p.join(AI,'TODO.md');"
        "if(fs.statSync(atd).isFile())out.todos[AI]=fs.readFileSync(atd,'utf8').slice(0,8000);}catch(_){}"
        "var ents=fs.readdirSync(AI,{withFileTypes:true})"
        ".filter(function(e){return e.isDirectory()&&e.name.charAt(0)!=='.'&&e.name.indexOf('Archived')!==0;})"
        ".map(function(e){return e.name;}).sort();"
        "for(var i=0;i<ents.length;i++){var full=p.join(AI,ents[i]);out.folders.push(full);"
        "try{var td=p.join(full,'TODO.md');"
        "if(fs.statSync(td).isFile())out.todos[full]=fs.readFileSync(td,'utf8').slice(0,8000);}"
        "catch(_){}}}catch(_){}return out;});}catch(_){}})();\n"
    )
    ix = ix + handler
    ix_changed = True
    print("  Appended cc-ai-data-v2 ipcMain handler to main bundle")
else:
    print("  cc-ai-data-v2 ipcMain handler already present in main bundle")

# ── One-click workspace folder open.
#    The renderer can only trigger the app's native folder picker; it cannot
#    pass a path. So we (1) add a 'cc-arm-folder' ipcMain handler that stores a
#    pending path, and (2) patch the browseFolder IPC handler to return that
#    stored path (skipping showOpenDialog) the next time it's invoked. The
#    renderer arms the path, then clicks "Open folder…", and React receives the
#    path as if the user had picked it. Both pieces are idempotent.
if "cc-arm-folder" not in ix:
    arm = (
        ";(function(){try{var _e=require('electron');var _armed=null,_ts=0;"
        "_e.ipcMain.handle('cc-arm-folder',function(ev,pth){_armed=pth?String(pth):null;_ts=Date.now();return true;});"
        "globalThis.__ccConsumeArmedFolder=function(){"
        "if(_armed&&Date.now()-_ts<8000){var p=_armed;_armed=null;return p;}_armed=null;return null;};"
        "}catch(_){}})();\n"
    )
    ix = ix + arm
    ix_changed = True
    print("  Appended cc-arm-folder ipcMain handler to main bundle")
else:
    print("  cc-arm-folder ipcMain handler already present in main bundle")

if "if(__cc)return __cc;" not in ix:
    # browseFolder handler arg count varies by release (3 params in the old
    # asar, 5 in the v3.0.0-rebase build) — match any arg list.
    ix2, n_bf = re.subn(
        r'(_\\\$_FileSystem_\\\$_browseFolder",async\([^)]*\)=>\{)',
        r'\1var __cc=globalThis.__ccConsumeArmedFolder&&globalThis.__ccConsumeArmedFolder();if(__cc)return __cc;',
        ix
    )
    if n_bf:
        ix = ix2
        ix_changed = True
        print(f"  Patched browseFolder handler to honor armed folder ({n_bf} site(s))")
    else:
        print("  WARNING: browseFolder handler signature not found — folder one-click open disabled")
else:
    print("  browseFolder handler already honors armed folder")

if "cc-open-folder" not in ix:
    opener = (
        ";(function(){try{var _e=require('electron');"
        "_e.ipcMain.handle('cc-open-folder',function(ev,pth){"
        "if(pth&&typeof pth==='string')_e.shell.openPath(pth);"
        "return true;});}catch(_){}})();\n"
    )
    ix = ix + opener
    ix_changed = True
    print("  Appended cc-open-folder ipcMain handler to main bundle")
else:
    print("  cc-open-folder ipcMain handler already present in main bundle")

if ix_changed:
    with open(main_path, "w") as f:
        f.write(ix)
PYEOF

echo "→ Syntax-checking patched JS..."
node --check "$EXTRACT/.vite/build/mainView.js"
node --check "$MAIN_BUNDLE"

echo "→ Repacking asar..."
npx @electron/asar pack "$EXTRACT" /tmp/claude-ui-patched.asar
cp /tmp/claude-ui-patched.asar "$ASAR"

echo "✓ Done. Restart Claude Desktop to apply changes."
