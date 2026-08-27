# Architecture Notes

Detailed technical discoveries about how the patching stack works.
See [AGENTS.md](../AGENTS.md) for the quick-reference overview.

---

## Patching stack (detailed)

```
AppRun (shell script)
  └─ launcher-common.sh   ← sourced by AppRun, builds electron args
       └─ electron binary
            └─ app.asar   ← we patch this with update-ui.sh
                 ├─ frame-fix-entry.js    (upstream wrapper, DO NOT TOUCH)
                 ├─ frame-fix-wrapper.js  (upstream wrapper, DO NOT TOUCH)
                 └─ .vite/build/
                      ├─ index.pre.js    (main process, DO NOT TOUCH)
                      ├─ index.js        ← PATCHED (folder picker + cc-ai-data IPC)
                      └─ mainView.js     ← PATCHED (preload)
                           └─ embeds custom-ui/ modules via executeJavaScript
```

`update-ui.sh` steps:
1. Concatenates `custom-ui/*.js` modules → combined `custom-ui.js`
2. Extracts asar → `/tmp/claude-ui-work/`
3. Python: JSON-encodes `custom-ui.js`, splices into `mainView.js` between sentinels
4. Also patches `index.js`: folder-picker defaultPath + `cc-ai-data` ipcMain handler
5. Syntax-checks both files with `node --check`
6. Repacks asar → copies over live asar

---

## Titlebar architecture - hybrid mode

`frame-fix-wrapper.js` supports three modes via `CLAUDE_TITLEBAR_STYLE` env var:

| Mode | frame | Result |
|------|-------|--------|
| `hybrid` (default) | `true` | KDE native titlebar on top + claude.ai in-app topbar (40px) below it |
| `native` | `true` | KDE native titlebar only; claude.ai hides its own topbar via UA gate |
| `hidden` | `false` | Frameless + WCO - **BROKEN on X11** (drag region intercepts mouse events) |

**In hybrid mode** there are TWO bars stacked:
1. KDE window decorations (OS-level, ~30px, can't hide from renderer)
2. Claude.ai's in-app topbar (HTML, 40px, controlled by WCO shim)

The WCO shim in `mainView.js` fakes `navigator.windowControlsOverlay` and
`window.matchMedia("(display-mode: window-controls-overlay)")` so that claude.ai thinks
it's in WCO mode and renders its in-app topbar.

Key constants injected by the shim:
```javascript
var CONTROLS_WIDTH = 140;  // right margin for OS window controls
var TITLEBAR_HEIGHT = 40;  // reported to claude.ai as the topbar height
```

---

## Preload sandbox constraint

The `mainView.js` `webPreferences` block in `index.js` sets neither `sandbox` nor
`contextIsolation` → Electron defaults: **`sandbox:true`, `contextIsolation:true`**.

In a sandboxed preload:
- `require('fs')` and `require('os')` are **unavailable** (throw immediately)
- `require('electron')` IS available
- `webFrame.executeJavaScript()` runs code in the page's main world (DOM + localStorage)
- `contextBridge.exposeInMainWorld()` exposes preload APIs to the page

This is why:
- Custom code is **embedded at patch time** by `update-ui.sh` (can't read files at runtime)
- Injection uses `webFrame.executeJavaScript()` - same mechanism as the WCO shim
- Folder list baked as `CC_AI_LOCAL` + live via `cc-ai-data` IPC (main process has `fs`)
- `eval()` in the preload would run in the isolated world, not the main world

---

## "Negative space" root cause (v6 discovery)

Hiding the in-app topbar with `display:none` left a `padding-top` that claude.ai had set
based on the WCO rect height (40px). Fix:
1. Patch `navigator.windowControlsOverlay.getTitlebarAreaRect()` to return `height=0`
2. Dispatch a `resize` event so React recalculates the layout

---

## dframe layout (v7 discovery)

Claude Desktop wraps content in its own layout system:
- `#dframe-main` / `.dframe-content` had `padding-top` reserved for the topbar → causes
  empty space after topbar is hidden. Fixed: CSS `padding-top:0!important`.
- `.dframe-sidebar` wasn't filling full height. Fixed: `min-height:100%;align-self:stretch`.

---

## dframe sidebar redesign (2026-06 discovery - v10)

Claude shipped a completely new sidebar DOM structure. Key changes:

**Before (≤v9):**
- Chat rows were `<a href="/chat/ID">` anchors
- Chat ID was available in the URL

**After (v10+):**
- Chat rows are `<div data-row>` containers
- Each row has `<button data-row-main-button>` (title/click target)
- And `<button aria-label="More options for <Title>">` (only on chats, not project headers)
- **NO chat ID anywhere in the DOM**
- Project headers have `"New session in <Name>"` instead of `"More options for <Title>"`
- Active chat carries `data-selected="focused"` on the row

**Impact:** ring/pin persistence must key on chat **title** (read from the full, untruncated
aria-label of the "More options" button). Two identically-titled chats would collide - rare,
accepted.

**Usage button:** aria-label changed to `"Usage: plan 7%"` (no `context`, no weekly).
**Weekly reset:** changed from weekday+time ("Resets Wed 9:59 AM") to calendar date ("Resets Jun 24").

---

## Sidebar toggle button

The frame-fix comment: *"buttons we care about all live in the in-app topbar."* These buttons
are inside the now-hidden topbar, but `document.querySelector()` finds hidden elements.
`Ctrl+Shift+L` priority order:
1. Exact aria-label match (Close/Open/Toggle sidebar)
2. Partial `*sidebar*` match with `:not([aria-haspopup])` guard
3. First non-menu button in `_topBarEl` (leftmost = sidebar toggle in claude.ai)
4. Fallback Ctrl+\ event

---

## Workspace click failure root cause (v6)

`.click()` doesn't work on Radix UI dropdown items - they require the full pointer-event
sequence. Fixed with `fireClick()` that dispatches:
`pointerover → mouseover → pointerdown → mousedown → pointerup → mouseup → click`

Also added `waitNewMenu()` which tracks existing menus and only resolves when a **new**
`[role="menu"]` appears. The v6 version had a "global fallback" that returned ALL existing
Radix items if no new menu appeared within the timeout - this caused the folder picker to
open then immediately close (it clicked a stale item). Removed in v7.

**isTrusted issue:** Radix's pointer handlers check `event.isTrusted`. Synthetic
`dispatchEvent` calls always have `isTrusted: false`. Three workaround approaches:
1. **`tryFiberClick()`** - calls React's fiber event handlers directly (bypasses isTrusted)
2. **Keyboard nav** - `Home → ArrowDown×N → Enter`; Radix keydown handlers don't check isTrusted
3. **`ccBridge.openFolder(path)`** - main-process `browseFolder` IPC (v13+, bypasses the DOM entirely)

---

## "Attach debugger?" Electron popup

An Electron/Chromium dialog with "Cancel" and "Attach" buttons. Likely triggered by a VS Code
debugger or Chrome DevTools instance attempting to auto-attach to Claude Desktop's Node.js
process. Since it's a DOM-level dialog (not OS-level), `custom-ui.js` can catch it with
`dismissStartupPopups()` and auto-click Cancel.

---

## Top bar "returning after React re-render" (v7 fix)

JS-only `display:none` approach was vulnerable to React unmounting and remounting the element
(which creates a fresh DOM node with no inline style). Fixed with CSS rule:
`[data-top-left="true"]{display:none!important}` - applies regardless of when/how the element
is created, survives React re-renders.

---

## Plan usage endpoint (2026-08-18 discovery)

The main-process bundle carries the tray usage feature. Search `[plan-usage]` in
`.vite/build/index.chunk-*.js` to find it again after an upgrade. What it does:

```
GET <apiHost>/api/organizations/<orgUuid>/usage      # net.fetch, 300s timer, 15s timeout
```

Response (zod schema in the same region of the bundle):

```jsonc
{
  "five_hour":            {"utilization": 6,  "resets_at": "<ISO>"},
  "seven_day":            {"utilization": 83, "resets_at": "<ISO>"},   // all models
  "seven_day_opus":       {...}, "seven_day_sonnet":     {...},
  "seven_day_oauth_apps": {...}, // = Claude Code
  "seven_day_cowork":     {...}, "seven_day_omelette":   {...},        // = Claude Design
  "omelette_promotional": {...}, // grant; the app deliberately hides its reset time
  "extra_usage": {"is_enabled": bool, "monthly_limit": n, "used_credits": n, "utilization": n}
}
```

- `utilization` is **0-100**, not 0-1. Any bucket the account doesn't have comes back null.
- `resets_at` is an **ISO timestamp**. Nothing has to parse "Resets Wed 1:39 AM" any more.
- `orgUuid` comes from the `lastActiveOrg` cookie (that is where the main process reads it);
  `GET /api/organizations` is the fallback.
- The renderer shares the main process's Electron session, so a same-origin credentialed
  `fetch()` from `custom-ui.js` sees exactly the same data. That is what `usage.js` does.

**There is no endpoint for the context window.** That figure is computed client-side and only
surfaces in the usage popover, so `usage.js` scrapes it opportunistically and shows `--`
otherwise. Do not "fix" that by opening the popover on a timer - see issues-fixed #13.

---

## Session facts on disk (2026-08-27 discovery)

The renderer knows the route (`/epitaxy/local_<uuid>`) and nothing else. Everything about *which
session that is* lives on disk, which is what `cc-session-info` (main process) reads:

```
<userData>/claude-code-sessions/<org>/<account>/<sessionId>.json
    {"sessionId":"local_...","cliSessionId":"...","cwd":"/home/.../Claude Desktop 🤖",
     "title":"...","model":"claude-opus-5", ...}

~/.claude/projects/<slug>/<cliSessionId>.jsonl        the transcript
```

`<slug>` is the cwd with every character that is not a letter or digit replaced by a dash, per
UTF-16 code unit - an emoji becomes two dashes, so `Claude Desktop 🤖` ends in three. The handler
falls back to scanning `~/.claude/projects` when the slug misses.

Context used = the last assistant entry's `usage`: `input_tokens + cache_read_input_tokens +
cache_creation_input_tokens + output_tokens`. The same arithmetic the CLI shows. No limit is
recorded there, which is why the window *size* has to be learned rather than assumed.

The sidebar keys a project group by `data-row-key`: `label:project-<path>` for a plain folder,
`label:project-<owner>/<repo>` when the folder has a git remote. The second form is labelled with
the repo name, which is why only remote-having folders lost their emoji (see issues-fixed #50).

## CDP debugging (defunct since v1.9255.0)

**Version 1.9255.0 added a security check:** if `--remote-debugging-port` is in argv without
a valid `CLAUDE_CDP_AUTH` token (signed with Anthropic's Ed25519 key), the app calls
`process.exit(1)` immediately. We removed the flag from `launcher-common.sh`.

**CDP debugging is now blocked** - `cdp-debug.py` no longer works. The only debug path is
`update-ui.sh` + restart. Console output goes to:
- `~/.config/Claude/logs/claude.ai-web.log` - renderer-level (React errors, `console.error`)
- `~/.config/Claude/logs/main-window.log` - preload-level (JS errors in mainView.js)

## ccBridge IPC channels (2026-08-21)

Everything the renderer can ask the main process to do. The renderer and preload are both
sandboxed - no `fs`, no `child_process` - so each of these exists because the panel needed a fact
or an effect that only the main process can produce. All are appended to the main bundle by
`update-ui.sh`; the doc/ssh group lives inside `/*cc-block:docs*/ … /*cc-block:docs-end*/` and is
removed-and-rewritten on every run, so editing it in the script is enough (no manual cleanup).

| Channel | Bridge method | Does |
|---|---|---|
| `cc-ai-data-v2` | (auto, on load) | Live folder list + each folder's `TODO.md`, read fresh at page load so renames don't need a re-patch |
| `cc-arm-folder` | `armFolder(p)` | Stores a path that the next `browseFolder` returns instead of opening the OS picker (8s window) |
| `cc-open-folder` | `openFolder(p)` | `shell.openPath` |
| `cc-write-todo-v2` | `writeTodo(p,t)` | Legacy TODO-only writer, kept so an app patched by an older `update-ui.sh` still saves |
| `cc-list-docs-v2` | `listDocs(p)` | `.md`/`.txt` files in a project folder, `TODO.md` first, max 40 |
| `cc-read-doc-v2` | `readDoc(p,f)` | One document, max 200 KB |
| `cc-write-doc-v2` | `writeDoc(p,f,t)` | Writes it back, tmp+rename, previous content snapshotted to `~/.config/Claude/todo-backups/<project>/<file>.<iso>.md`, newest 20 per file |
| `cc-list-remote-v2` | `listRemote(h,p)` | `ssh <host> ls -1p -- <dir>`, filtered to documents |
| `cc-read-remote-v2` | `readRemote(h,p,f)` | `ssh <host> cat -- <dir>/<file>` |

**Containment rules**, all enforced in the main process, never in the renderer:

- Local paths must resolve inside `~/Documents/AI Projects` (`full === ROOT || full.startsWith(ROOT + sep)`).
- Filenames must have no `/` or `\`, no `..`, no leading `.`, and a `.md`/`.txt` extension.
- SSH host names must match `[A-Za-z0-9._-]{1,64}`; the remote path is single-quoted. `execFile`
  is used, so no local shell is involved either. BatchMode means it never prompts.
- Remote is **read-only** on purpose - the panel disables its editor for remote folders rather than
  offering one that silently can't save.

The checks are written without regexes or backslash escapes where the input is a filename: the
source string passes through an unquoted bash heredoc and then a Python literal before it is ever
JS, and each layer has its own opinion about backslashes.

Verified end to end (2026-08-21) against the patched bundle with a stubbed `ipcMain`: listing,
reading, write + backup round-trip, and every guard above - `/etc`, `../../../etc/passwd.md`,
`secrets.env`, `.hidden.md`, a `.sh` file, and `bad;rm -rf /` as a host name all rejected.
