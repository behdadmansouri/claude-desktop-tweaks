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
#     ($eipc_message$_<uuid>_$_...) - extracted dynamically from mainView.js.
set -e

# Resolve the project dir regardless of whether this script is called via symlink.
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODULES_DIR="$PROJECT_DIR/custom-ui"

# Build combined custom-ui.js from individual module files.
echo "→ Building custom-ui.js from modules..."
{
  printf '/**\n * Claude Desktop custom UI - v19\n * Generated from custom-ui/ modules by update-ui.sh - do not edit directly.\n */\n'
  printf '(function () {\n'"'"'use strict'"'"';\n\n'
  cat "$MODULES_DIR/css.js"
  printf '\n'
  cat "$MODULES_DIR/workspace.js"
  printf '\n'
  cat "$MODULES_DIR/labels.js"
  printf '\n'
  cat "$MODULES_DIR/session.js"
  printf '\n'
  cat "$MODULES_DIR/usage.js"
  printf '\n'
  cat "$MODULES_DIR/chrome.js"
  printf '\n'
  cat "$MODULES_DIR/diag.js"
  printf '\n'
  cat "$MODULES_DIR/titlewatch.js"
  printf '\n'
  cat "$MODULES_DIR/bootstrap.js"
  printf '\n})();\n'
} > "$PROJECT_DIR/custom-ui.js"
echo "  $(wc -l < "$PROJECT_DIR/custom-ui.js") lines built"

CUSTOM="$PROJECT_DIR/custom-ui.js"

# Which install to patch. Everything downstream locates its targets by content
# signature rather than by version or filename, so the same patch applies to
# either build - the only thing that differs is the prefix.
#
#   (default)     ~/.local/lib/claude-desktop-patched   -- the daily driver
#   --official    ~/.local/lib/claude-desktop-official  -- Anthropic's own build
#   --prefix DIR  anything else
#
# The official build is REVERTED by scripts/install-official.sh on every update,
# because that script replaces the whole prefix. Re-run this with --official
# afterwards; there is nothing here that persists across a reinstall.
TARGET="patched"
PATCHED_ROOT="$HOME/.local/lib/claude-desktop-patched"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --official)
      TARGET="official"
      PATCHED_ROOT="$HOME/.local/lib/claude-desktop-official"
      shift ;;
    --prefix)
      TARGET="custom"
      PATCHED_ROOT="${2:?--prefix needs a directory}"
      shift 2 ;;
    -h|--help)
      echo "usage: $0 [--official | --prefix DIR]"
      exit 0 ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      echo "usage: $0 [--official | --prefix DIR]" >&2
      exit 1 ;;
  esac
done

ASAR="$PATCHED_ROOT/usr/lib/claude-desktop/resources/app.asar"
# Separate work directories, so patching one build can never pick up the other's
# extracted tree.
EXTRACT="/tmp/claude-ui-work-$TARGET"
# The two builds run on separate Electron profiles on purpose (both have appName
# "Claude", and sharing one profile between two processes risks LevelDB
# corruption). Anything this script writes into a profile has to follow.
if [[ "$TARGET" == "official" ]]; then
  PROFILE_DIR="$HOME/.config/ClaudeOfficial"
else
  PROFILE_DIR="$HOME/.config/Claude"
fi

echo "  Target: $TARGET ($PATCHED_ROOT)"

if [[ ! -f "$ASAR" ]]; then
  echo "ERROR: asar not found at $ASAR" >&2
  echo "  (expected new v3.0.0-rebase layout - usr/lib/claude-desktop/resources/app.asar)" >&2
  if [[ "$TARGET" == "official" ]]; then
    echo "  Install it first: scripts/install-official.sh" >&2
  fi
  exit 1
fi

echo "→ Extracting asar..."
rm -rf "$EXTRACT"
npx --yes @electron/asar extract "$ASAR" "$EXTRACT"

# Locate the main-process bundle by content signature rather than filename -
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
#    (no asar repack needed after a rename - just run refresh-folders.sh)
folders_json = os.path.join("$PROFILE_DIR", "cc-folders.json")
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

# -- Map "owner/repo" to the folder that has it as a remote.
#    Measured 2026-08-27: the app keys a sidebar project group by its git remote
#    when the folder has one (data-row-key="label:project-behdadmansouri/dogether")
#    and by full path when it does not. A remote-keyed group is labelled with the
#    repo name, which is why exactly the five folders with a GitHub remote lost
#    the emoji off their name. labels.js needs this to put it back.
#    .git/config is parsed directly rather than shelling out to git: this heredoc
#    is unquoted, so every subprocess call is one more chance for bash to eat it.
repos = {}
url_re = re.compile(r"url\s*=\s*(\S+)")
for path in ai_list:
    cfg = os.path.join(path, ".git", "config")
    if not os.path.isfile(cfg):
        continue
    try:
        with open(cfg, encoding="utf-8", errors="replace") as cf:
            for m in url_re.finditer(cf.read()):
                u = m.group(1)
                if u.endswith(".git"):
                    u = u[:-4]
                parts = [p for p in re.split(r"[:/]", u) if p]
                if len(parts) >= 2:
                    repos[parts[-2] + "/" + parts[-1]] = os.path.basename(path)
    except Exception:
        pass
print(f"  Mapped {len(repos)} git remotes to folder names")

with open("$CUSTOM") as f:
    code = f.read()

# Bake CC_AI_LOCAL as a build-time fallback (in case cc-folders.json is missing)
code = ("const CC_AI_TODOS=" + json.dumps(todos) + ";\n"
        + "const CC_AI_REPOS=" + json.dumps(repos) + ";\n"
        + "const CC_AI_LOCAL=" + json.dumps(ai_list) + ";\n" + code)
encoded = json.dumps(code)

mv_path = "$EXTRACT/.vite/build/mainView.js"
with open(mv_path) as f:
    mv = f.read()

# ── Extract this build's eipc UUID from mainView.js so the Ctrl+Q handler
#    invokes the right channel. The UUID changes every release; the
#    "claude.web_DOLLAR_WindowControl_DOLLAR_close" suffix has been stable
#    across the 2.1.x and 3.x lines observed so far.
# (Built via chr(36) rather than a literal "\$" in this source file - the
#  bash heredoc here is unquoted, so a literal $ would trigger bash variable
#  expansion, and getting the backslash-escaping right for both a *regex*
#  meta-dollar and a *plain-string* dollar in the same heredoc is error-prone.
#  chr(36) sidesteps both.)
D = chr(36)
uuid_re = re.compile(re.escape(D) + r'eipc_message' + re.escape(D) + r'_([0-9a-fA-F-]+)_' + re.escape(D) + r'_')
m = uuid_re.search(mv)
if not m:
    raise RuntimeError("Could not find eipc UUID in mainView.js - Ctrl+Q channel unknown")
eipc_uuid = m.group(1)
close_channel = D + "eipc_message" + D + "_" + eipc_uuid + "_" + D + "_claude.web_" + D + "_WindowControl_" + D + "_close"
print(f"  eipc UUID: {eipc_uuid}")

idx = mv.find("// ── custom-ui loader")

expose = (
    "try{_cb.exposeInMainWorld('ccBridge',{"
    "armFolder:function(p){return _ipc.invoke('cc-arm-folder',p);},"
    "openFolder:function(p){return _ipc.invoke('cc-open-folder',p);},"
    "writeTodo:function(p,t){return _ipc.invoke('cc-write-todo-v2',p,t);},"
    "listDocs:function(p){return _ipc.invoke('cc-list-docs-v2',p);},"
    "readDoc:function(p,f){return _ipc.invoke('cc-read-doc-v2',p,f);},"
    "writeDoc:function(p,f,t){return _ipc.invoke('cc-write-doc-v2',p,f,t);},"
    "listRemote:function(h,p){return _ipc.invoke('cc-list-remote-v2',h,p);},"
    "readRemote:function(h,p,f){return _ipc.invoke('cc-read-remote-v2',h,p,f);},"
    "sshConfigs:function(){return _ipc.invoke('cc-ssh-configs');},"
    "listTree:function(p,r){return _ipc.invoke('cc-list-tree-v2',p,r);},"
    "listTreeRemote:function(h,p){return _ipc.invoke('cc-list-tree-remote-v2',h,p);},"
    "setTitle:function(t){return _ipc.invoke('cc-set-title',t);},"
    "sessionInfo:function(id){return _ipc.invoke('cc-session-info',id);}"
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
# trailing sourceMappingURL comment (or EOF) - NOT just up to the end_marker
# text, which would leave the old block's function body dangling behind the
# newly-inserted one (produces a corrupt duplicate - caught by node --check
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
BUILD_DIR = os.path.dirname(main_path)

# -- Patching across chunks, and across quote styles. --------------------------
#
#    Two things stopped being safe assumptions with the official 1.26832.0 build
#    (measured 2026-09-01, all four main-process patches missed at once):
#
#      1. ONE CHUNK. Everything we patch used to sit in the same chunk that
#         registers browseFolder. It no longer does: the folder-picker default
#         path, the window frame and the keep-awake claim each live in a
#         different chunk now. So a site is located by CONTENT across every
#         chunk, and only the appended ipcMain handlers still go to a fixed
#         file (any main-process chunk would do for those; MAIN_BUNDLE is
#         chosen because locating it already proves it is main-process code).
#
#      2. DOUBLE QUOTES. This build's minifier emits template literals where
#         the old one emitted "..." - titleBarStyle:BThiddenBT, not
#         titleBarStyle:"hidden". Nothing here may hard-code a quote character;
#         use QUOTE, which matches either.
#
#    A literal backtick cannot appear anywhere in this heredoc (it is UNQUOTED,
#    so bash would run it as a command), hence chr(96).
BT = chr(96)
QUOTE = "[" + chr(34) + BT + "]"

import glob

_text = {}
_dirty = set()

def rd(path):
    # errors="surrogateescape" so a chunk carrying a stray byte round-trips
    # unchanged instead of raising or being silently mangled.
    if path not in _text:
        with open(path, encoding="utf-8", errors="surrogateescape") as f:
            _text[path] = f.read()
    return _text[path]

def wr(path, body):
    _text[path] = body
    _dirty.add(path)

def all_chunks():
    rest = sorted(p for p in glob.glob(os.path.join(BUILD_DIR, "*.js"))
                  if p != main_path)
    return [main_path] + rest

def patch_every(pattern, repl, what, guard=None):
    # Applies to EVERY chunk that matches, not the first one found. A site that
    # moved chunks between releases is now the normal case; a site that exists
    # in two chunks at once is not, and shows up here as a total > 1 rather
    # than being silently half-patched.
    if guard is not None:
        for path in all_chunks():
            if guard in rd(path):
                print("  " + what + " already patched")
                return -1
    rx = re.compile(pattern)
    hits = 0
    for path in all_chunks():
        body, n = rx.subn(repl, rd(path))
        if n:
            wr(path, body)
            hits += n
            print("  Patched " + what + " in " + os.path.basename(path)
                  + " (" + str(n) + " site(s))")
    if not hits:
        print("  WARNING: " + what + " not found - left unpatched")
    return hits

# ── Folder-picker default. Two shapes seen so far:
#      defaultPath:e??s.homedir()        1.24012.9
#      defaultPath:t??(0,k.homedir)()    1.26832.0 (rollup interop call form)
#    Both end up wrapped in the same concatenation. Idempotent: once wrapped,
#    the pattern no longer matches its own output.
_ident = re.escape(D) + r"?\w+"
_homedir = "((?:" + _ident + r"\.homedir\(\)|\(0,\s*" + _ident + r"\.homedir\)\(\)))"
patch_every(
    r'defaultPath:(\w+)\?\?' + _homedir,
    lambda m: ('defaultPath:' + m.group(1) + '??(' + m.group(2)
               + '+"/Documents/AI Projects")'),
    "folder-picker defaultPath")

# Everything below appends to the main bundle. Read it AFTER the cross-chunk
# passes above, so an edit landing in this same file is not thrown away.
ix = rd(main_path)
ix_changed = False

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

# ── Teach browseFolder to honour an armed path.
#    Found by plain string search, NOT a regex. The regex this replaces spelled
#    the channel name as _\\\$_FileSystem_\\\$_browseFolder, and an unquoted
#    heredoc turns \\\$ into a bare $ - which in a regex is an end-of-string
#    anchor, so the pattern could never match anything. It looked like it
#    worked only because the daily build's asar is re-extracted from its own
#    already-patched copy, carrying a patch applied before that breakage.
#
#    The handler's argument list has grown across releases (3 params, then 5)
#    and the channel name is quoted with " in one build and a backtick in the
#    next, so the search stops at the marker and then walks forward to the
#    arrow-function brace rather than trying to describe the whole thing.
_bf_guard = "if(__cc)return __cc;"
_bf_inject = ("var __cc=globalThis.__ccConsumeArmedFolder&&"
              "globalThis.__ccConsumeArmedFolder();" + _bf_guard)
_bf_marker = "_" + D + "_FileSystem_" + D + "_browseFolder"
if _bf_guard in ix:
    print("  browseFolder handler already honors armed folder")
else:
    n_bf, _from = 0, 0
    while True:
        m_at = ix.find(_bf_marker, _from)
        if m_at < 0:
            break
        _from = m_at + len(_bf_marker)
        # Only the ipc.handle registration, never removeHandler or the
        # browseFolderS sibling: require ",async(" to open right after the
        # closing quote of the channel name.
        head = ix[_from:_from + 10]
        if not (head[:1] in (chr(34), BT) and head[1:8] == ",async("):
            continue
        brace = ix.find(")=>{", _from)
        if brace < 0:
            continue
        cut = brace + len(")=>{")
        ix = ix[:cut] + _bf_inject + ix[cut:]
        _from = cut + len(_bf_inject)
        n_bf += 1
    if n_bf:
        ix_changed = True
        print(f"  Patched browseFolder handler to honor armed folder ({n_bf} site(s))")
    else:
        print("  WARNING: browseFolder handler signature not found - folder one-click open disabled")

# ── Write a folder's TODO.md back to disk, so the panel's preview pane can be
#    an editor rather than a viewer. Deliberately narrow: the path must resolve
#    inside ~/Documents/AI Projects and the file written is always TODO.md, so a
#    compromised renderer can't turn this into an arbitrary-file-write primitive.
#    Writes via a temp file + rename so a crash mid-write can't truncate a real
#    TODO.md. Idempotent, guarded by the channel name.
#
#    Every overwrite snapshots the PREVIOUS content first, keeping the newest 20
#    versions per project. Backups live under ~/.config/Claude/todo-backups/
#    rather than beside the file, so a hidden directory doesn't appear inside
#    every project (several are git repos). This is an autosaving editor bound
#    to a debounce timer: "I selected all and typed over it" has to be
#    recoverable without the user having thought about it in advance.
BLOCK_A, BLOCK_B = "/*cc-block:write-todo*/", "/*cc-block:write-todo-end*/"
if BLOCK_A in ix:
    ix = ix[:ix.index(BLOCK_A)] + ix[ix.index(BLOCK_B) + len(BLOCK_B):]
    print("  Removed previous cc-write-todo block for replacement")
if True:
    writer = (
        BLOCK_A + ";(function(){try{var _e=require('electron'),fs=require('fs'),"
        "p=require('path'),os=require('os');"
        "var ROOT=p.resolve(p.join(os.homedir(),'Documents','AI Projects'));"
        "var BAK=p.join(_e.app.getPath('userData'),'todo-backups');"
        "function snap(dir,dest){try{"
        "if(!fs.existsSync(dest))return;"
        "var prev=fs.readFileSync(dest,'utf8');"
        "var slug=p.basename(dir).replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,80)||'root';"
        "var d=p.join(BAK,slug);fs.mkdirSync(d,{recursive:true});"
        "var last=fs.readdirSync(d).filter(function(f){return /^TODO\\..*\\.md$/.test(f);}).sort();"
        "if(last.length&&fs.readFileSync(p.join(d,last[last.length-1]),'utf8')===prev)return;"
        "fs.writeFileSync(p.join(d,'TODO.'+new Date().toISOString().replace(/[:.]/g,'-')+'.md'),prev,'utf8');"
        "var all=fs.readdirSync(d).filter(function(f){return /^TODO\\..*\\.md$/.test(f);}).sort();"
        "while(all.length>20){try{fs.unlinkSync(p.join(d,all.shift()));}catch(_){}}"
        "}catch(_){}}"
        "_e.ipcMain.handle('cc-write-todo-v2',function(ev,dir,text){try{"
        "if(typeof dir!=='string'||typeof text!=='string')return{ok:false,error:'bad args'};"
        "if(text.length>200000)return{ok:false,error:'too large'};"
        "var full=p.resolve(dir);"
        "if(full!==ROOT&&full.indexOf(ROOT+p.sep)!==0)return{ok:false,error:'outside AI Projects'};"
        "if(!fs.statSync(full).isDirectory())return{ok:false,error:'not a directory'};"
        "var dest=p.join(full,'TODO.md'),tmp=dest+'.cc-tmp';"
        "snap(full,dest);"
        "fs.writeFileSync(tmp,text,'utf8');fs.renameSync(tmp,dest);"
        "return{ok:true};}catch(e){return{ok:false,error:String(e&&e.message||e)};}});"
        "}catch(_){}})();" + BLOCK_B + "\n"
    )
    ix = ix + writer
    ix_changed = True
    print("  Wrote cc-write-todo-v2 ipcMain handler (with backups) to main bundle")

# ── Read/list/write ANY markdown file in a project folder, not just TODO.md.
#    The preview pane's file picker needs three things the TODO-only channel
#    couldn't do: enumerate a folder's documents, read one of them, and write one
#    back. Same containment rule as cc-write-todo-v2 - the directory must resolve
#    inside ~/Documents/AI Projects - plus a filename whitelist: no separators,
#    no "..", and a .md/.txt extension. Note the checks are written WITHOUT
#    regexes or backslash escapes on purpose: this string passes through an
#    unquoted bash heredoc and then a python literal before it is ever JS, and
#    each layer has its own opinion about backslashes.
BLOCK_C, BLOCK_D = "/*cc-block:docs*/", "/*cc-block:docs-end*/"
if BLOCK_C in ix:
    ix = ix[:ix.index(BLOCK_C)] + ix[ix.index(BLOCK_D) + len(BLOCK_D):]
    print("  Removed previous cc-docs block for replacement")
docs = (
    BLOCK_C + ";(function(){try{var _e=require('electron'),fs=require('fs'),"
    "p=require('path'),os=require('os'),cp=require('child_process');"
    "var BS=String.fromCharCode(92);"
    "var ROOT=p.resolve(p.join(os.homedir(),'Documents','AI Projects'));"
    "var BAK=p.join(_e.app.getPath('userData'),'todo-backups');"
    # A document name we are willing to touch.
    "function okName(f){if(typeof f!=='string')return false;"
    "if(!f.length||f.length>120)return false;"
    "if(f.split('/').length>1||f.split(BS).length>1)return false;"
    "if(f.indexOf('..')>=0||f.charAt(0)==='.')return false;"
    "var lo=f.toLowerCase();return lo.slice(-3)==='.md'||lo.slice(-4)==='.txt';}"
    # A directory inside the projects root.
    "function okDir(d){if(typeof d!=='string'||!d)return null;"
    "var full=p.resolve(d);"
    "if(full!==ROOT&&full.indexOf(ROOT+p.sep)!==0)return null;"
    "try{if(!fs.statSync(full).isDirectory())return null;}catch(_){return null;}"
    "return full;}"
    # TODO.md always sorts first; it is what the pane opens with.
    "function rank(a,b){if(a==='TODO.md')return -1;if(b==='TODO.md')return 1;"
    "return a.toLowerCase()<b.toLowerCase()?-1:1;}"
    "_e.ipcMain.handle('cc-list-docs-v2',function(ev,dir){try{"
    "var full=okDir(dir);if(!full)return{ok:false,error:'outside AI Projects'};"
    "var files=fs.readdirSync(full,{withFileTypes:true})"
    ".filter(function(e){return e.isFile()&&okName(e.name);})"
    ".map(function(e){return e.name;}).sort(rank).slice(0,40);"
    "return{ok:true,files:files};}"
    "catch(e){return{ok:false,error:String(e&&e.message||e)};}});"
    # ── Browsing, not just listing. The app's own file panel (ctrl+shift+F) is
    #    only available once a session has started, so on the new-session page
    #    there is no way to look at a project's files at all. This is the panel's
    #    own answer: directories and files for any subpath of a project, with the
    #    resolved path re-checked against ROOT after joining, so "../.." in the
    #    relative part cannot walk out.
    "function okRel(r){if(r==null||r==='')return true;"
    "if(typeof r!=='string'||r.length>400)return false;"
    "return r.split(BS).length===1;}"
    "_e.ipcMain.handle('cc-list-tree-v2',function(ev,dir,rel){try{"
    "var base=okDir(dir);if(!base)return{ok:false,error:'outside AI Projects'};"
    "if(!okRel(rel))return{ok:false,error:'bad path'};"
    "var full=p.resolve(p.join(base,rel||''));"
    "if(full!==ROOT&&full.indexOf(ROOT+p.sep)!==0)return{ok:false,error:'outside AI Projects'};"
    "if(!fs.statSync(full).isDirectory())return{ok:false,error:'not a directory'};"
    "var ents=fs.readdirSync(full,{withFileTypes:true})"
    ".filter(function(e){return e.name.charAt(0)!=='.';})"
    ".map(function(e){return{name:e.name,dir:e.isDirectory()};})"
    ".sort(function(a,b){if(a.dir!==b.dir)return a.dir?-1:1;"
    "return a.name.toLowerCase()<b.name.toLowerCase()?-1:1;}).slice(0,300);"
    "return{ok:true,entries:ents};}"
    "catch(e){return{ok:false,error:String(e&&e.message||e)};}});"
    "_e.ipcMain.handle('cc-read-doc-v2',function(ev,dir,file){try{"
    "var full=okDir(dir);if(!full)return{ok:false,error:'outside AI Projects'};"
    "if(!okName(file))return{ok:false,error:'not a document'};"
    "var t=p.join(full,file);"
    "if(!fs.statSync(t).isFile())return{ok:false,error:'not a file'};"
    "return{ok:true,text:fs.readFileSync(t,'utf8').slice(0,200000)};}"
    "catch(e){return{ok:false,error:String(e&&e.message||e)};}});"
    # Same backup-before-overwrite discipline as the TODO writer, keyed by
    # project AND filename so editing NOTES.md can't evict TODO.md's history.
    "function snap(dir,file,dest){try{"
    "if(!fs.existsSync(dest))return;"
    "var prev=fs.readFileSync(dest,'utf8');"
    "var slug=p.basename(dir).replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,80)||'root';"
    "var d=p.join(BAK,slug);fs.mkdirSync(d,{recursive:true});"
    "var pre=file+'.';"
    "function mine(f){return f.indexOf(pre)===0;}"
    "var last=fs.readdirSync(d).filter(mine).sort();"
    "if(last.length&&fs.readFileSync(p.join(d,last[last.length-1]),'utf8')===prev)return;"
    "fs.writeFileSync(p.join(d,pre+new Date().toISOString().replace(/[:.]/g,'-')+'.md'),prev,'utf8');"
    "var all=fs.readdirSync(d).filter(mine).sort();"
    "while(all.length>20){try{fs.unlinkSync(p.join(d,all.shift()));}catch(_){}}"
    "}catch(_){}}"
    "_e.ipcMain.handle('cc-write-doc-v2',function(ev,dir,file,text){try{"
    "if(typeof text!=='string')return{ok:false,error:'bad args'};"
    "if(text.length>200000)return{ok:false,error:'too large'};"
    "var full=okDir(dir);if(!full)return{ok:false,error:'outside AI Projects'};"
    "if(!okName(file))return{ok:false,error:'not a document'};"
    "var dest=p.join(full,file),tmp=dest+'.cc-tmp';"
    "snap(full,file,dest);"
    "fs.writeFileSync(tmp,text,'utf8');fs.renameSync(tmp,dest);"
    "return{ok:true};}catch(e){return{ok:false,error:String(e&&e.message||e)};}});"
    # ── Remote (SSH) reads. The panel's Remote column lists folders on hosts
    #    configured as SSH connections; nothing local can see them, which is why
    #    those entries always previewed as "No TODO.md". This shells out to ssh
    #    in BatchMode (never prompts, fails fast if the host or key isn't set up)
    #    and is strictly READ-only: two commands, cat and ls, both on a path the
    #    renderer already knew. The host must look like an ssh alias and the path
    #    is single-quoted, so neither can smuggle in a second command.
    "var chr39=String.fromCharCode(39),chr10=String.fromCharCode(10);"
    "function q(s){return chr39+String(s).split(chr39).join(chr39+BS+chr39+chr39)+chr39;}"
    # An ssh target, which may be user@host. '@' is allowed; anything that could
    # start a second command or a new argument is not.
    "function okHost(h){if(typeof h!=='string'||!h.length||h.length>96)return false;"
    "for(var i=0;i<h.length;i++){var c=h.charAt(i);"
    "if(!(c>='a'&&c<='z')&&!(c>='A'&&c<='Z')&&!(c>='0'&&c<='9')"
    "&&c!=='.'&&c!=='-'&&c!=='_'&&c!=='@')return false;}"
    "return true;}"
    # The panel knows a connection by its DISPLAY name ("Myserver", "Dad"); ssh
    # needs the real target ("myserver", "Dr") and sometimes an identity file.
    # The app already stores that mapping in ssh_configs.json, so read it rather
    # than asking the user to repeat it. A name that isn't in the file is tried
    # as-is, which keeps hand-typed hosts working.
    "var SSHCFG=p.join(_e.app.getPath('userData'),'ssh_configs.json');"
    "function resolveHost(name){var out={target:name,id:null};try{"
    "var j=JSON.parse(fs.readFileSync(SSHCFG,'utf8'));"
    "var want=String(name).toLowerCase();"
    "var hit=(j.configs||[]).filter(function(c){"
    "return c&&String(c.name||'').toLowerCase()===want;})[0];"
    "if(hit){if(hit.sshHost)out.target=hit.sshHost;"
    "if(hit.sshIdentityFile)out.id=String(hit.sshIdentityFile)"
    ".replace(/^~/,os.homedir());}}catch(_){}return out;}"
    "_e.ipcMain.handle('cc-ssh-configs',function(){try{"
    "var j=JSON.parse(fs.readFileSync(SSHCFG,'utf8'));"
    "return{ok:true,hosts:(j.configs||[]).map(function(c){"
    "return{name:String(c.name||''),sshHost:String(c.sshHost||'')};})"
    ".filter(function(h){return h.name;})};}"
    "catch(e){return{ok:false,error:String(e&&e.message||e)};}});"
    "function ssh(name,cmd){return new Promise(function(res){"
    "var r=resolveHost(name);"
    "if(!okHost(r.target))return res({ok:false,error:'not an ssh host name'});"
    "var args=['-o','BatchMode=yes','-o','ConnectTimeout=6','-n'];"
    "if(r.id)args=args.concat(['-i',r.id]);"
    "args=args.concat([r.target,cmd]);"
    "cp.execFile('ssh',args,"
    "{timeout:9000,maxBuffer:1048576},function(err,out,serr){"
    "if(err)return res({ok:false,error:(String(serr||err.message||err).split(chr10)[0]||'ssh failed').slice(0,160)});"
    "res({ok:true,out:String(out)});});});}"
    # The DISPLAY name is validated loosely here (it can contain spaces); the
    # resolved ssh target is validated strictly inside ssh().
    "function okName2(n){return typeof n==='string'&&n.length>0&&n.length<=64;}"
    "_e.ipcMain.handle('cc-read-remote-v2',function(ev,host,dir,file){"
    "if(!okName2(host))return Promise.resolve({ok:false,error:'bad host name'});"
    "if(typeof dir!=='string'||!dir)return Promise.resolve({ok:false,error:'bad path'});"
    "if(!okName(file))return Promise.resolve({ok:false,error:'not a document'});"
    "return ssh(host,'cat -- '+q(dir+'/'+file)).then(function(r){"
    "return r.ok?{ok:true,text:r.out.slice(0,200000)}:r;});});"
    # Remote equivalent of cc-list-tree-v2. "ls -1pA" marks directories with a
    # trailing slash, which is the whole reason -p is there.
    #
    # (No backticks in these comments, ever. This heredoc is UNQUOTED, so bash
    # expands its contents before python sees them - a backticked "ls" in a
    # comment here was executed, and the directory listing was spliced into the
    # middle of a string literal.)
    "_e.ipcMain.handle('cc-list-tree-remote-v2',function(ev,host,dir){"
    "if(!okName2(host))return Promise.resolve({ok:false,error:'bad host name'});"
    "if(typeof dir!=='string'||!dir)return Promise.resolve({ok:false,error:'bad path'});"
    "return ssh(host,'ls -1pA -- '+q(dir)).then(function(r){"
    "if(!r.ok)return r;"
    "var ents=r.out.split(chr10).map(function(s){return s.replace(/\\s+$/,'');})"
    ".filter(function(s){return s&&s.charAt(0)!=='.';})"
    ".map(function(s){var d=s.slice(-1)==='/';"
    "return{name:d?s.slice(0,-1):s,dir:d};})"
    ".sort(function(a,b){if(a.dir!==b.dir)return a.dir?-1:1;"
    "return a.name.toLowerCase()<b.name.toLowerCase()?-1:1;}).slice(0,300);"
    "return{ok:true,entries:ents};});});"
    "_e.ipcMain.handle('cc-list-remote-v2',function(ev,host,dir){"
    "if(!okName2(host))return Promise.resolve({ok:false,error:'bad host name'});"
    "if(typeof dir!=='string'||!dir)return Promise.resolve({ok:false,error:'bad path'});"
    "return ssh(host,'ls -1p -- '+q(dir)).then(function(r){"
    "if(!r.ok)return r;"
    "var files=r.out.split(chr10).map(function(s){return s.trim();})"
    ".filter(okName).sort(rank).slice(0,40);"
    "return{ok:true,files:files};});});"
    "}catch(_){}})();" + BLOCK_D + "\n"
)
ix = ix + docs
ix_changed = True
print("  Wrote cc-docs ipcMain handlers (list/read/write + ssh read) to main bundle")

# ── Native window title.
#    titlewatch.js has been setting document.title for months and the KWin
#    watcher feeding ActivityWatch still only ever saw "Claude" - confirmed by
#    reading the bucket: every Claude event is {"app":"Claude","title":"Claude"}.
#    Electron normally mirrors the page title onto the window, so something in
#    the app suppresses it (a page-title-updated handler that preventDefaults, or
#    an explicit setTitle). Rather than find and fight that, go around it: the
#    renderer asks for the title it wants and the main process sets it on the
#    BrowserWindow directly, which nothing else overrides.
if "cc-set-title" not in ix:
    titler = (
        ";(function(){try{var _e=require('electron');"
        "_e.ipcMain.handle('cc-set-title',function(ev,t){try{"
        "if(typeof t!=='string')return false;"
        # Newlines stripped without a regex: a backslash escape here would be
        # eaten by the bash heredoc before python ever saw it (which it was, once
        # - node --check caught the broken literal).
        "t=t.split(String.fromCharCode(10)).join(' ')"
        ".split(String.fromCharCode(13)).join(' ').slice(0,200);"
        "var w=_e.BrowserWindow.fromWebContents(ev.sender);"
        "if(w&&!w.isDestroyed())w.setTitle(t||'Claude');"
        "return true;}catch(_){return false;}});}catch(_){}})();\n"
    )
    ix = ix + titler
    ix_changed = True
    print("  Appended cc-set-title ipcMain handler to main bundle")
else:
    print("  cc-set-title ipcMain handler already present in main bundle")

# ── Session facts the renderer cannot reach.
#    Two long-running complaints share one cause: the renderer knows the route
#    (/epitaxy/local_<uuid>) and nothing else. It cannot see which PROJECT the
#    session belongs to (so the window title, and therefore every ActivityWatch
#    event, says only "Code"), and it cannot see the token count (so the context
#    figure only exists while the usage popover is open).
#
#    The app writes both facts to disk itself. Each session has a record at
#    <userData>/claude-code-sessions/<org>/<account>/<sessionId>.json carrying
#    cwd, cliSessionId, title and model, and cliSessionId names a real transcript
#    at ~/.claude/projects/<slug>/<cliSessionId>.jsonl whose last assistant entry
#    carries a usage object. Main process has fs; renderer does not. Hence this.
#
#    Cost is bounded: the record is a direct path hit, and the transcript is read
#    as a tail (400 KB, last 500 lines scanned) rather than parsed whole - these
#    files run to tens of megabytes on a long session.
if "cc-session-info" not in ix:
    sessinfo = (
        ";(function(){try{var _e=require('electron');"
        "var _fs=require('fs'),_p=require('path'),_os=require('os');"
        # Claude Code's project-directory slug is the cwd with every character
        # that is not a letter or digit replaced by a dash, per UTF-16 code unit
        # - which is why an emoji folder becomes three dashes, not one.
        "function _slug(s){var o='';for(var i=0;i<s.length;i++){"
        "var c=s.charAt(i);o+=(/[A-Za-z0-9]/.test(c)?c:'-');}return o;}"
        "function _rec(id){"
        "var base=_p.join(_e.app.getPath('userData'),'claude-code-sessions');"
        "var l1=[];try{l1=_fs.readdirSync(base);}catch(_){return null;}"
        "for(var a=0;a<l1.length;a++){var d1=_p.join(base,l1[a]);var l2=[];"
        "try{l2=_fs.readdirSync(d1);}catch(_){continue;}"
        "for(var b=0;b<l2.length;b++){var f=_p.join(d1,l2[b],id+'.json');"
        "try{if(_fs.existsSync(f))return JSON.parse(_fs.readFileSync(f,'utf8'));}catch(_){}}}"
        "return null;}"
        # Context = what the model was actually holding on the last turn: fresh
        # input plus both cache halves plus what it wrote. Same arithmetic the
        # CLI shows; no limit is recorded here, so the total stays the renderer's
        # problem (it learns that from the app's own popover once and caches it).
        "function _ctx(cli,cwd){"
        "if(!cli)return null;"
        "var root=_p.join(_os.homedir(),'.claude','projects');var file=null;"
        "if(cwd){var g=_p.join(root,_slug(cwd),cli+'.jsonl');"
        "try{if(_fs.existsSync(g))file=g;}catch(_){}}"
        "if(!file){var ds=[];try{ds=_fs.readdirSync(root);}catch(_){return null;}"
        "for(var i=0;i<ds.length;i++){var c=_p.join(root,ds[i],cli+'.jsonl');"
        "try{if(_fs.existsSync(c)){file=c;break;}}catch(_){}}}"
        "if(!file)return null;"
        "var st=_fs.statSync(file);var len=Math.min(st.size,400000);"
        "if(len<=0)return null;"
        "var fd=_fs.openSync(file,'r');var buf=Buffer.alloc(len);"
        "_fs.readSync(fd,buf,0,len,st.size-len);_fs.closeSync(fd);"
        "var lines=buf.toString('utf8').split(String.fromCharCode(10));"
        "var floor=Math.max(0,lines.length-500);"
        "for(var j=lines.length-1;j>=floor;j--){var ln=lines[j];"
        "if(!ln||ln.charAt(0)!=='{')continue;var o=null;"
        "try{o=JSON.parse(ln);}catch(_){continue;}"
        "var u=o&&o.message&&o.message.usage;if(!u)continue;"
        "var used=(u.input_tokens||0)+(u.cache_read_input_tokens||0)"
        "+(u.cache_creation_input_tokens||0)+(u.output_tokens||0);"
        "if(used>0)return {used:used,at:o.timestamp||null};}"
        "return null;}"
        "_e.ipcMain.handle('cc-session-info',function(ev,id){try{"
        "if(typeof id!=='string'||!id||id.length>80)return null;"
        # The id is pasted into a path, so it may only be an id.
        "if(id.indexOf('/')>=0||id.indexOf('.')>=0)return null;"
        "var r=_rec(id);if(!r)return null;"
        "var cwd=r.cwd||r.originCwd||'';var c=null;"
        "try{c=_ctx(r.cliSessionId,cwd);}catch(_){}"
        "return {cwd:cwd,project:cwd?_p.basename(cwd):'',title:r.title||'',"
        "model:r.model||'',ctxUsed:c?c.used:null,ctxAt:c?c.at:null};"
        "}catch(_){return null;}});}catch(_){}})();\n"
    )
    ix = ix + sessinfo
    ix_changed = True
    print("  Appended cc-session-info ipcMain handler to main bundle")
else:
    print("  cc-session-info ipcMain handler already present in main bundle")

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

# -- Hand the window frame back to KWin. --------------------------------------
#
#    The main window is created with titleBarStyle:"hidden", which on Linux means
#    no window manager decoration at all - so the app has to draw its own close /
#    maximize controls in HTML, and you lose every KDE affordance that hangs off
#    a real titlebar (window rules, tiling shortcuts, the window menu, snapping).
#    titleBarOverlay is set alongside it but is Windows-only in this build (the
#    app's own guard logs "titleBarOverlay only works on Windows"), so on Linux
#    it is simply a frameless window.
#
#    "default" restores frame:true, and KWin decorates it like any other window.
#    Kept conditional on Linux so the same patch stays harmless if it is ever run
#    against another platform's build.
#
#    Matched on the minWidth/minHeight pair because titleBarStyle:"hidden"
#    appears twice - the other one is the Quick Entry overlay, which is SUPPOSED
#    to be frameless and must not be touched.
#    In 1.26832.0 the window is created in index.js rather than in the chunk
#    that owns the IPC handlers, and "hidden" is written as a template literal,
#    so this goes through patch_every like the other cross-chunk sites.
#
#    Flush the appended handlers into the file cache first: the passes below
#    read through rd(), and main_path may well be one of the files they touch.
if ix_changed:
    wr(main_path, ix)

# The marker is a COMMENT, not an extra option: these options are handed to a
# validator that whitelists keys, so an unknown one risks the main window
# failing to create at all.
_n_tb = patch_every(
    r'minWidth:600,minHeight:400,titleBarStyle:' + QUOTE + 'hidden' + QUOTE,
    'minWidth:600,minHeight:400,/*__ccNativeFrame*/'
    'titleBarStyle:process.platform==="linux"?"default":"hidden"',
    "main-window titleBarStyle (native frame on Linux)",
    guard="__ccNativeFrame")
if _n_tb > 1:
    raise RuntimeError("main-window titleBarStyle signature is no longer unique")

# -- Make "keep computer awake" mean "while working", not "while running". -----
#
#    The app claims powerSaveBlocker('prevent-app-suspension') once, at startup,
#    the instant the keepAwakeEnabled pref is true - and holds it until quit.
#    Measured 2026-08-25: main.log had a single
#      [keep-awake] started (id=0, first claim=keepAwakeEnabled)
#    from three days earlier and no matching "stopped" since. So an idle laptop
#    never sleeps, which is the symptom. Note the pref defaults to FALSE and is
#    flipped on for you - the build carries a wakeSchedulerCourtesyFlippedKeepAwake
#    flag - so turning it off by hand does not stay off.
#
#    The upstream shape is:
#      const s7e="keepAwakeEnabled";
#      function a7e(){kt("keepAwakeEnabled")===!0?GTn(s7e):ZTn(s7e)}
#      function XTn(){ks.on("keepAwakeEnabled",a7e),a7e()}
#    ...with every one of those names regenerated per release, so this is located
#    by the one stable thing in it: the pref name. Two edits:
#      1. the claim becomes conditional on globalThis.__ccWorkActive()
#      2. the installer re-evaluates on a timer, not only on a settings change
#    plus an appended IIFE that defines the predicate.
#
#    Parsed by string search rather than a regex on purpose: this heredoc is
#    UNQUOTED, so backslashes are a hazard (see the note at the end of
#    memory/issues-fixed.md) and a regex for minified identifiers is all
#    backslashes.
#    The pref name is quoted with " in one build and a backtick in the next, and
#    since 1.26832.0 it lives in its own chunk rather than the main bundle, so
#    both spellings are searched for across every chunk.
_ka_path, _ka, _k = None, None, -1
for _cand in all_chunks():
    _body_text = rd(_cand)
    if "__ccWorkActive" in _body_text:
        _ka_path, _k = _cand, -2
        break
    for _q in (chr(34), BT):
        _p = "(" + _q + "keepAwakeEnabled" + _q + ")===!0?"
        _at = _body_text.find(_p)
        if _at >= 0:
            _ka_path, _ka, _k = _cand, _body_text, _at
            break
    if _k >= 0:
        break

if _k == -2:
    print("  keep-awake governor already present in " + os.path.basename(_ka_path))
elif _k < 0:
    print("  WARNING: keepAwakeEnabled claim not found - sleep stays blocked for the whole session")
else:
    ix = _ka
    _j = ix.rfind("function ", 0, _k)
    _open = ix.find("{", _j)
    _end = ix.find("}", _k)
    _fn = ix[_j + len("function "):ix.find("(", _j)]
    _body = ix[_open + 1:_end]
    # kt("keepAwakeEnabled")===!0 ? GTn(s7e) : ZTn(s7e)
    _cond, _rest = _body.split("?", 1)
    _claim, _release = _rest.split(":", 1)
    if "{" in _body or "}" in _body:
        raise RuntimeError("keep-awake claim body is not the expected one-liner: " + _body[:120])
    _new = (
        "function " + _fn + "(){"
        "var _on=(" + _cond + ");var _busy=true;"
        # Fail SAFE: if the predicate is missing or throws, assume work is in
        # progress and keep blocking. A laptop that sleeps mid-run is a much
        # worse failure than one that stays awake an hour too long.
        "try{if(typeof globalThis.__ccWorkActive==='function')_busy=globalThis.__ccWorkActive();}"
        "catch(_ka){_busy=true;}"
        "if(_on&&_busy){" + _claim + ";}else{" + _release + ";}}"
    )
    ix = ix[:_j] + _new + ix[_end + 1:]

    # The installer only re-ran this on a settings change, so a conditional claim
    # would latch at startup and never be revisited. Re-evaluate every minute.
    _p2 = -1
    for _q in (chr(34), BT):
        _p2 = ix.find(".on(" + _q + "keepAwakeEnabled" + _q + ",")
        if _p2 >= 0:
            break
    if _p2 < 0:
        raise RuntimeError("keepAwakeEnabled settings-subscribe site not found")
    _e2 = ix.find("}", _p2)
    ix = ix[:_e2] + ",setInterval(" + _fn + ",60000)" + ix[_e2:]

    # The predicate. "Working" = some Claude Code session file was touched
    # recently, read from the profile the app is actually running on.
    #
    # Touched, not lastActivityAt: that field only moves at turn boundaries (a
    # live session was measured 16 minutes stale mid-turn), and a window that
    # short would suspend the machine in the middle of a long run. File mtime is
    # a superset of real activity - it also moves for unrelated rewrites - and
    # erring toward "busy" is the direction that cannot lose work.
    #
    # Deliberately NOT keyed on window focus: an app left focused overnight is
    # exactly the reported situation, and focus would re-create the bug.
    _gov = (
        ";(function(){try{var _e=require('electron'),fs=require('fs'),p=require('path');"
        "var MIN=parseInt(process.env.CC_KEEPAWAKE_IDLE_MIN||'',10);if(!(MIN>0))MIN=30;"
        "var WIN=MIN*60000,_hit=0,_at=0,_last=null;"
        "function touched(){var now=Date.now();"
        # One filesystem sweep a minute at most, whatever calls this.
        "if(now-_at<45000)return _hit;_at=now;var best=0;"
        "try{var root=p.join(_e.app.getPath('userData'),'claude-code-sessions');"
        "var orgs=fs.readdirSync(root);"
        "for(var a=0;a<orgs.length;a++){var od=p.join(root,orgs[a]),accts;"
        "try{accts=fs.readdirSync(od);}catch(_1){continue;}"
        "for(var b=0;b<accts.length;b++){var ad=p.join(od,accts[b]),files;"
        "try{files=fs.readdirSync(ad);}catch(_2){continue;}"
        "for(var c=0;c<files.length;c++){if(files[c].indexOf('local_')!==0)continue;"
        "try{var m=fs.statSync(p.join(ad,files[c])).mtimeMs;if(m>best)best=m;}catch(_3){}}}}"
        # An unreadable session store is not evidence of idleness.
        "}catch(_4){best=now;}"
        "_hit=best;return _hit;}"
        "globalThis.__ccWorkActive=function(){try{"
        "var busy=(Date.now()-touched())<WIN;"
        "if(busy!==_last){_last=busy;try{console.log('[cc-keep-awake] '+(busy?'working':'idle')+"
        "' (idle window '+MIN+'m)');}catch(_5){}}"
        "return busy;}catch(_6){return true;}};"
        "}catch(_){}})();\n"
    )
    wr(_ka_path, ix + _gov)
    print("  Patched keep-awake to release when idle (function " + _fn
          + ", 30m window, in " + os.path.basename(_ka_path) + ")")

# ── Write out every chunk that changed, and leave the list where bash can pick
#    it up: which files got touched is now a per-release fact, so the syntax
#    check cannot be a hard-coded pair of filenames any more.
for _path in sorted(_dirty):
    with open(_path, "w", encoding="utf-8", errors="surrogateescape") as f:
        f.write(_text[_path])
with open("$EXTRACT/.cc-patched-files", "w") as f:
    f.write("\n".join(sorted(_dirty)) + ("\n" if _dirty else ""))
print(f"  Wrote {len(_dirty)} patched chunk(s)")
PYEOF

echo "→ Syntax-checking patched JS..."
node --check "$EXTRACT/.vite/build/mainView.js"
# Every chunk the python pass rewrote, not just the main bundle - a syntax error
# in any of them takes the whole main process down at launch.
while read -r f; do
  [[ -n "$f" ]] || continue
  node --check "$f"
  echo "  ok $(basename "$f")"
done < "$EXTRACT/.cc-patched-files"
rm -f "$EXTRACT/.cc-patched-files"

echo "→ Repacking asar..."
npx @electron/asar pack "$EXTRACT" /tmp/claude-ui-patched-$TARGET.asar
# Swap it in with a same-directory rename rather than copying over the live
# file. Electron mmaps the asar, so truncating it under a RUNNING app corrupts
# the pages it is still reading and can take the app down mid-write. A rename
# leaves the old inode intact for anything that still has it open.
cp /tmp/claude-ui-patched-$TARGET.asar "$ASAR.new"
mv -f "$ASAR.new" "$ASAR"

echo "✓ Done. Restart Claude Desktop to apply changes."
