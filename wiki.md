# Claude Desktop Patching — Session Wiki

## Current state (as of 2026-06-18)

App version: **2.1.181** (electron resources; patched copy)
custom-ui.js: **v8**
**Loader: sandbox-safe — injects via `webFrame.executeJavaScript`, no `require('fs')`** (fixed 2026-06-18)
Patched install: `~/.local/lib/claude-desktop-patched/`
Original AppImage: `/opt/claude-desktop/claude-desktop.AppImage` (untouched)
GitHub repo: https://github.com/behdadmansouri/claude-desktop-tweaks

---

## How the patching stack works

```
AppRun (shell script)
  └─ launcher-common.sh   ← sourced by AppRun, builds electron args
       └─ electron binary
            └─ app.asar   ← we patch this with update-ui.sh
                 ├─ frame-fix-entry.js    (upstream wrapper, DO NOT TOUCH)
                 ├─ frame-fix-wrapper.js  (upstream wrapper, DO NOT TOUCH)
                 └─ .vite/build/
                      ├─ index.pre.js    (main process, DO NOT TOUCH)
                      └─ mainView.js     ← we patch this (preload)
                           └─ embeds custom-ui.js via executeJavaScript
```

`update-ui.sh` (symlinked at `~/.config/Claude/update-ui.sh`):
1. Extracts asar → `/tmp/claude-ui-work/`
2. Python: reads `~/.config/Claude/custom-ui.js`, JSON-encodes it, splices it into `mainView.js` between the `// ── custom-ui loader` and `// ── Ctrl+Q to quit` sentinels
3. Repacks asar → `/tmp/claude-ui-patched.asar` → copies over live asar

After running `update-ui.sh`, restart Claude Desktop for changes to take effect.

---

## Architecture discoveries

### Titlebar architecture — hybrid mode

Frame-fix-wrapper.js supports three modes via `CLAUDE_TITLEBAR_STYLE` env var:

| Mode | frame | Result |
|------|-------|--------|
| `hybrid` (default) | `true` | KDE native titlebar on top + claude.ai in-app topbar (40px) below it |
| `native` | `true` | KDE native titlebar only; claude.ai hides its own topbar via UA gate |
| `hidden` | `false` | Frameless + WCO — **BROKEN on X11** (drag region intercepts mouse events) |

**In hybrid mode** there are TWO bars stacked:
1. KDE window decorations (OS-level, ~30px, can't hide from renderer)
2. Claude.ai's in-app topbar (HTML, 40px, controlled by WCO shim)

The WCO shim in `mainView.js` fakes `navigator.windowControlsOverlay` and `window.matchMedia("(display-mode: window-controls-overlay)")` so that claude.ai thinks it's running in WCO mode and renders its in-app topbar.

Key constants injected by the shim:
```javascript
var CONTROLS_WIDTH = 140;  // right margin for OS window controls
var TITLEBAR_HEIGHT = 40;  // reported to claude.ai as the topbar height
```

### "Negative space" root cause (v6 discovery)
Hiding the in-app topbar with `display:none` left a `padding-top` that claude.ai had set based on the WCO rect height (40px). Fix: patch `navigator.windowControlsOverlay.getTitlebarAreaRect()` to return height=0 **and** dispatch a `resize` event so React recalculates the layout.

### dframe layout (v7 discovery)
Claude Desktop wraps content in its own layout system:
- `#dframe-main` / `.dframe-content` had `padding-top` reserved for the topbar → causes empty space after topbar is hidden. Fixed by adding CSS `padding-top:0!important`.
- `.dframe-sidebar` wasn't filling full height. Fixed by adding `min-height:100%;align-self:stretch` via CSS.

### Sidebar toggle button
The frame-fix comment says: *"buttons we care about (hamburger / sidebar / search / nav / Cowork ghost) all live in the in-app topbar"*. These buttons are inside the now-hidden topbar, but `document.querySelector()` finds hidden elements. Ctrl+Shift+L priority order:
1. Exact aria-label match (Close/Open/Toggle sidebar)
2. Partial `*sidebar*` match with `:not([aria-haspopup])` guard
3. First non-menu button in `_topBarEl` (leftmost = sidebar toggle in claude.ai)
4. Fallback Ctrl+\ event

### Workspace click failure root cause (v6)
`.click()` doesn't work on Radix UI dropdown items — they require the full pointer-event sequence. Fixed with `fireClick()` that dispatches `pointerover → mouseover → pointerdown → mousedown → pointerup → mouseup → click`. Also added `waitNewMenu()` which tracks existing menus and only resolves when a **new** `[role="menu"]` appears.

The v6 `waitNewMenu()` had a "global fallback" that returned ALL existing Radix items if no new menu appeared within the timeout — this caused the folder picker to open but immediately close (it clicked a stale item). Removed in v7.

### "Attach debugger?" Electron popup
An Electron/Chromium dialog with "Cancel" and "Attach" buttons. Likely triggered by a VS Code debugger or Chrome DevTools instance attempting to auto-attach to Claude Desktop's Node.js process. Since it's a DOM-level dialog (not OS-level), `custom-ui.js` can catch it with `dismissStartupPopups()` and auto-click Cancel.

---

## Known issues fixed

### 1. `--remote-debugging-port` kills the app silently (FIXED)
**Version 1.9255.0 added a security check:** if `--remote-debugging-port` is in argv without a valid `CLAUDE_CDP_AUTH` token (signed with Anthropic's Ed25519 key), the app calls `process.exit(1)` immediately. We had added this flag to `launcher-common.sh` for CDP debugging — removed it.

**File changed:** `~/.local/lib/claude-desktop-patched/usr/lib/claude-desktop/launcher-common.sh` (line removed)

**CDP debugging is now blocked** — `cdp-debug.py` no longer works. The only debug path is `update-ui.sh` + restart.

### 2. MutationObserver crash in custom-ui.js (FIXED)
`document.documentElement` was null when `bootstrap()` first ran (Electron renderer timing). Added a 100ms retry loop.

### 3. Renderer hang after ~2 minutes (FIXED)
The `MutationObserver` was calling `scan()` directly on every DOM mutation. Claude.ai (React) fires hundreds of mutations per second → renderer thread overwhelmed → detected as "unresponsive" → killed.

**Fix:** Debounced the observer callback to coalesce mutations into one `scan()` call per 300ms. Also slowed `setInterval` from 1200ms → 2000ms.

### 4. Workspace panel stacking/darkening (FIXED)
Multiple panel elements were accumulating in the DOM. Fixed with class-based cleanup.

### 5. Workspace click not selecting folder (FIXED v6, improved v7)
Root cause: Radix UI requires full pointer-event sequence, not just `.click()`. Also `waitMenu()` was finding stale menu items. Fixed with `fireClick()` + `waitNewMenu()`. v7 removed the global fallback that was returning existing items.

### 6. Negative space after hiding topbar (FIXED v6+v7)
v6: patch `navigator.windowControlsOverlay.getTitlebarAreaRect()` → 0 height + `resize` event + base CSS reset.
v7: also add CSS `#dframe-main,.dframe-content{padding-top:0!important}`.

### 7. Top bar returning after React re-render (FIXED v7)
JS-only `display:none` approach was vulnerable to React unmounting and remounting the element (which creates a fresh DOM node with no inline style). Added CSS rule `[data-top-left="true"]{display:none!important}` which applies regardless of when/how the element is created.

### 8. Usage badge colors (FIXED v7)
The number portion of badges (`42` in `C42%`) was rendered in white. Fixed by wrapping the entire `${letter}${pct}%` string in the color span, not just the letter.

### 9. Reset time badges always empty (FIXED v7)
`scanForUsageExtras()` was only scanning `[role="dialog"]` etc. (popups). Reset time is also shown in visible `.text-t6` / `.text-footnote` spans like `56% · resets 1h`. Added scanning of those elements. Also: `parseUsage()` now extracts reset times from the usage button's `aria-label` if present.

---

## Custom UI features — current state (v7)

### Feature 1: Usage badges  `C35% H81% 2h W45% 3d`
- **Status: Working**
- C (blue `#3b82f6`): context window % — letter AND number colored
- H (orange `#f59e0b`): hourly plan % — letter AND number colored
- 2h (dim white): hours until hourly plan resets
- W (green `#22c55e`): weekly usage % — letter AND number colored
- 3d (dim white): days until weekly usage resets
- Reset times parsed from: aria-label, `.text-t6` spans, popups/dialogs
- Selector: `button[aria-label^="Usage:"]`

### Feature 2: Startup popup auto-dismiss
- **Status: Working (v7)**
- Single-button dialogs with "OK/Got it/Dismiss/etc." → auto-click after 300ms
- "Attach debugger?" dialog (Attach + Cancel) → auto-click Cancel after 200ms
- Multi-button dialogs that don't match known patterns are left alone

### Feature 3: Code tab default
- **Status: Working (v7)**
- When an artifact panel appears with a tab bar, auto-clicks "Code" tab if not already selected
- 80ms delay to let React finish rendering the tab bar

### Feature 4: "Model unavailable" banner hidden
- **Status: Working (v7)**
- Text-content scan finds elements containing `* is currently unavailable` 
- Sets `display:none` on the containing banner element
- Runs on every scan cycle (MutationObserver + 2s interval)

### Feature 5: Top bar hidden + space reclaimed
- **Status: Working (v7)**
- PRIMARY: CSS rule `[data-top-left="true"]{display:none!important}` — survives React re-renders
- SECONDARY: JS strategy (4-step detection) sets `display:none` as belt-and-suspenders
- TERTIARY: `patchWCOHeight()` → WCO shim reports 0 → React resets padding-top
- Base CSS resets `padding-top` on `html`, `body`, `#__next`, `#dframe-main`, `.dframe-content`
- `.dframe-sidebar` filled to full height with `align-self:stretch`

### Feature 6: Keyboard shortcuts
- **Status: Working (v7)**
- **Ctrl+Q**: quit (in preload/mainView.js, not custom-ui.js)
- **Ctrl+O**: search
- **Ctrl+Shift+L**: sidebar toggle
- **Ctrl+Shift+R**: right panel toggle (new in v7)
- All run at capture phase

### Feature 7: Right panel — Obsidian-style tabs
- **Status: Partial (v7) — needs real selector verification**
- Tab bar injected at top of right panel: Preview | Code | Files
- Preview / Code delegate to the native artifact tabs
- Files tab shows workspace quick-picker list
- Detection relies on `[data-testid="artifact-panel"]` etc. — needs DOM inspection to confirm

### Feature 8: Views button hidden
- **Status: Partial (v7) — needs selector verification**
- Hidden via CSS: `button[data-testid="views-button"]`, `button[aria-label="Views"]`, etc.
- If still visible: inspect element, report `aria-label` or `data-testid`

### Feature 9: Prompt-cache freshness ring
- **Status: Rewritten 2026-06-16 — NOT YET VERIFIED**
- Amber outline + background tint on sidebar conversation links active within last 5 minutes
- **Old approach (broken):** CSS `box-shadow` on `a[data-cc-ring]` — was clipped by parent `overflow:hidden`
- **New approach:** direct `el.style.setProperty('outline', '2px solid #f59e0b', 'important')` + `background-color: rgba(245,158,11,.12)` — `outline` is not clipped by overflow:hidden; inline `!important` beats React inline styles
- Color changed from red → amber (`#f59e0b`, same as H badge) — "warm cache = warm color"
- Selector broadened: `a[href*="/chat/"],a[href*="/project/"]`
- TTL: 5 minutes; storage: `cc-cache-v4`

### Feature 10: Quick workspace panel
- **Status: Working (v6+v7), Local column overhauled 2026-06-16**
- Two-column floating panel (Local | Myserver) on new-session pages
- **Local column:** now baked from filesystem at patch time — `update-ui.sh` reads `~/Documents/AI Projects/` and embeds folder list as `const CC_AI_LOCAL=[...]` prepended to custom-ui.js. No longer shows stale "recent" entries. Re-run `update-ui.sh` after adding/removing project folders.
- **SSH column:** still uses localStorage recents (`cc-ws-v4`) — can't enumerate remote FS
- Folder click: `fireClick()` + `waitNewMenu()` + `tryFiberClick()` (React fiber handler direct call)
- Debug: `JSON.parse(localStorage.getItem('cc-ws-debug'))` shows last click attempt details

### Feature 11: Nav shortcuts Ctrl+1/2/3
- **Status: Added 2026-06-16 — NOT YET VERIFIED**
- Ctrl+1 = Chat, Ctrl+2 = Cowork, Ctrl+3 = Code
- Searches `nav/aside/[role="navigation"]` elements by text + aria-label + data-testid
- Fallback: `history.pushState` to `/`, `/cowork`, `/code` respectively

---

## Security review

| Area | Status | Notes |
|------|--------|-------|
| innerHTML injection | ✅ Safe | User data only enters DOM via `.textContent`, never `innerHTML` |
| localStorage reads | ✅ Safe | All wrapped in `try/catch`; JSON.parse failure returns empty defaults |
| `fireClick()` events | ✅ Safe | Only dispatched on user-initiated panel button clicks |
| Keyboard capture | ✅ Safe | `stopPropagation()` scoped to custom shortcuts only |
| WCO override | ✅ Safe | Modifies shim object (not native API); wrapped in try/catch |
| `cc-debug` localStorage | ✅ Safe | Stores element tagName + className substring; no sensitive data |
| Auto-dismiss | ✅ Safe | Only acts on single-button dialogs or exact "Attach/Cancel" pattern |

---

## Performance review

| Area | Cost | Notes |
|------|------|-------|
| MutationObserver | Low | Debounced 300ms |
| `setInterval` (scan) | Low | 2s interval |
| `applyRings()` | Low | O(n) where n = sidebar links |
| `hideTopBar()` | Near-zero after first run | Returns on `_topBarEl` cache hit; CSS does most work now |
| `scanForUsageExtras()` | Low | Queries dialogs + `.text-t6` — rarely many elements |
| `dismissStartupPopups()` | Near-zero | WeakSet check is O(1); only acts on new dialogs |
| `preferCodeTab()` | Near-zero | Skips already-seen tablists via `dataset.ccTabPref` |
| `hideUnavailableBanner()` | Low | TreeWalker text scan; rare matches |
| `waitNewMenu()` async | Low | Only on user click; 60ms poll for 2.5s max |
| `patchWCOHeight()` | One-time | Guarded by `_ccPatched` flag |
| WeakMap `_badgeRebuild` | ✅ | No retention of detached elements |

---

## Launcher config

`~/.local/lib/claude-desktop-patched/usr/lib/claude-desktop/launcher-common.sh`:
- Password store: kwallet6 (KDE Plasma 6)
- Ozone platform: x11 (XWayland — for global hotkey support)
- `--remote-debugging-port` REMOVED (breaks app since v1.9255.0)
- Close-to-tray: ON (frame-fix-wrapper setting)

---

## Workflow for future changes

```bash
# 1. Edit the script
code "/home/z3z0/Documents/AI Projects/Claude Desktop/custom-ui.js"

# 2. Rebuild
~/.config/Claude/update-ui.sh

# 3. Restart the app
~/.local/bin/claude-quit && sleep 1
# then launch from app menu, or:
~/.local/lib/claude-desktop-patched/AppRun &

# 4. Also push to GitHub
cd "/home/z3z0/Documents/AI Projects/Claude Desktop"
git add custom-ui.js && git commit -m "..." && git push
```

---

## Debugging notes

- `~/.config/Claude/logs/main.log` — main process log (startup, SSH, MCP servers)
- `~/.config/Claude/logs/main-window.log` — renderer/window log (JS errors in preload)
- `~/.config/Claude/logs/claude.ai-web.log` — web content log (claude.ai React errors)
- `~/.cache/claude-desktop-debian/launcher.log` — shell launcher log

**Topbar debug**: Check `localStorage.getItem('cc-debug')` — `0:data-top-left` means CSS strategy matched; `A/B/C` means JS fallback strategy matched.

If app exits silently after "Frame Fix Patches built successfully": something in `index.pre.js` is calling `process.exit(1)`. Check for security guards (like the CDP one above).

If renderer goes unresponsive: check `custom-ui.js` for anything blocking the JS main thread or firing too frequently.

---

## TODO / Known remaining issues

- [ ] Right panel tab injection — `[data-testid="artifact-panel"]` selector needs verification
- [ ] Views button exact selector — need `aria-label` or `data-testid` from DOM inspection
- [ ] Weekly `W%` may stay dimmed if usage popup is never opened during a session
- [ ] Sidebar toggle aria-label still unknown (CDP blocked)
- [ ] Workspace "new project on SSH" requires main-process IPC — out of scope for renderer
- [ ] KDE native titlebar (OS window decorations) — use KDE Window Rules to hide per-app
- [ ] Cache ring: verify amber outline is actually visible after 2026-06-16 rewrite
- [ ] Workspace folder click: verify `tryFiberClick` actually selects the folder (has never worked reliably)
- [ ] Ctrl+1/2/3 nav shortcuts: verify correct nav elements are found for chat/cowork/code

---

## Known issues fixed (continued)

### 10. Workspace panel always-on overlap with new-session overview (FIXED 2026-06-17)
Panel was `position:absolute` with no trigger — always visible on new-session pages, floating on top of the page overview. Two fixes: (a) panel hidden by default, shown only on `mouseenter` of the workspace row, hidden on `mouseleave` of both row and panel with 150ms grace period; (b) background hardcoded to `#f5f4ef` instead of `var(--bg-100)` which could inherit alpha.

### 11. Reset time badges (2h/3d) disappeared (FIXED 2026-06-17)
`scanForUsageExtras()` only queried `[role="dialog"],[role="tooltip"]` etc. Radix popovers in claude.ai render in `[data-radix-popper-content-wrapper]` and `[data-state="open"]` containers, which weren't in the selector list. Broadened selector to include those.

---

## Sessions

## Session — 2026-06-16

### What happened
- **Workspace panel local column:** changed from "recent history" to "full AI Projects scan". `update-ui.sh` now reads `~/Documents/AI Projects/` via Python `os.listdir` and prepends `const CC_AI_LOCAL=[...]` to the embedded JS. Panel's Local column now always shows all current projects sorted alphabetically; no more stale entries like "party".
- **Cache ring rewrite:** old `box-shadow` CSS approach was silently broken — box-shadow is clipped by `overflow:hidden` on sidebar parent elements. Replaced with direct inline `style.setProperty('outline', ..., 'important')` + `background-color` tint. Color changed to amber (matches H badge). Selector broadened to include `/project/` links.
- **File picker click (ongoing):** added `tryFiberClick()` — walks React's fiber tree via `el.__reactFiber$*` and calls `onClick`/`onPointerUp`/`onSelect` handlers directly. Bypasses `isTrusted` restrictions that block all synthetic `dispatchEvent` approaches. Also added `[data-cmdk-item]`/`[data-radix-collection-item]` to item selectors in case Claude uses cmdk. Added `localStorage['cc-ws-debug']` dump on each click attempt for diagnostics.
- **Nav shortcuts:** added Ctrl+1/2/3 for Chat/Cowork/Code. Searches nav/sidebar elements by text+aria-label, falls back to `history.pushState`.

### Decisions
- **Amber not red for cache ring:** red implies error; amber = warm/active, consistent with H badge color.
- **Embed folder list at patch time (not runtime):** renderer has no `fs` access; scanning at `update-ui.sh` time is clean and sufficient since project folders don't change frequently.
- **Remove keyboard Enter from folder selection:** the Enter dispatch was potentially closing the dropdown without selecting, or triggering the native OS file browser via the keyboard fallback path.
- **`tryFiberClick` approach:** if `isTrusted: false` is what's blocking all synthetic events in Radix, direct fiber handler invocation is the only path that doesn't require patching the main process.

### Current state
All changes baked and deployed via `update-ui.sh`. Three new features (cache ring rewrite, nav shortcuts, fiber click) need verification after restart — none have been visually confirmed working yet. Local column folder scan is the one change confirmed correct (Python output verified 14 folders).

### Open threads
- [ ] Restart Claude Desktop and verify amber cache ring is visible on recently-visited chats
- [ ] Test Ctrl+1/2/3 — if nav elements aren't found, inspect what's actually in the nav to fix selectors
- [ ] Test workspace panel folder click — if `tryFiberClick` still fails, check `localStorage['cc-ws-debug']` for item roles/values and report back

## Session — 2026-06-17

### What happened
- **Created `/wrap-up` slash command** — a global Claude Code command that writes session
  knowledge into the project's own markdown files (`wiki.md`, `agents.md`) at end of session,
  so conversations can be safely archived. Installed at `~/.claude/commands/wrap-up.md`.
- **Mapped the Claude Code skill/plugin system** — discovered the correct install locations:
  - `~/.claude/commands/*.md` → global slash commands (persists across updates, the right place)
  - `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/` → marketplace plugins (gets updated/overwritten)
  - `~/.config/Claude/local-agent-mode-sessions/skills-plugin/.../skills/` → Claude Desktop agent mode only, session-scoped
- **Reinforced portability preference** — user confirmed: no `~/.claude` for memories, no `CLAUDE.md`.
  All project knowledge lives in the project folder. `agents.md` is the primary context file.
  `wiki.md` is the running log.

### Decisions
- **`~/.claude/commands/` not the skills plugin dir** — the Desktop app's agent-mode skills dir is
  session-scoped and separate from Claude Code CLI. Custom slash commands go in `~/.claude/commands/`.
- **Write to project files, not memory system** — the built-in memory system (cross-session recall
  in `~/.claude/projects/`) is the wrong target. User keeps one session open at a time; portability
  matters more than Claude-internal memory. wiki.md + agents.md is the right target.
- **Skip `.skill` packaging for personal use** — packaging is for distribution. Dropping a
  `SKILL.md` or `commands/*.md` file directly is sufficient for personal install.

### Current state
`/wrap-up` is installed and working (just ran successfully). The skill writes to wiki.md and
agents.md in the project root. No ~/.claude references. Portable.

### Open threads
- [ ] Carry over from last session: verify amber cache ring, Ctrl+1/2/3 nav, tryFiberClick workspace folder click
- [ ] `agents.md` still has a `CLAUDE.md` listed in the project root — that file exists but shouldn't be the primary context file; consider whether to delete it or leave it inert

## Session — 2026-06-17 (session 2)

### What happened

**custom-ui.js — new features (all deployed via update-ui.sh, restart required):**
- **Chat number badges 1–9:** small dimmed badges appear before the first 9 sidebar chats. Selector: `nav a[href*="/chat/"], [data-sidebar] a[href*="/chat/"], aside a[href*="/chat/"]` filtered to visible + not inside a dialog or panel.
- **Alt+1-9 shortcuts:** jump to Nth visible sidebar chat. Same selector as badges.
- **Ctrl+W repurposed:** was a redundant "new session" shortcut (same as Ctrl+N). Now closes file viewers / preview overlays — looks for close buttons in dialogs, artifact panel, or any visible non-nav close button.
- **New-session overview hidden:** `hideNewSessionOverview()` targets `canvas`, `[data-testid*="overview"]`, etc. on non-chat pages and hides their nearest safe ancestor. Re-enable: `localStorage.setItem('ccShowOverview','1')`.
- **Workspace panel hover-triggered:** was always-visible (floating on top of overview). Now hidden by default; shown on `mouseenter` of workspace row or panel, hidden on `mouseleave` of both with 150ms grace.
- **Workspace panel 2-column grid:** folder list uses `display:grid;grid-template-columns:1fr 1fr` when >4 items.
- **Workspace panel solid background:** was `var(--bg-100)` which could be transparent. Changed to hardcoded `#f5f4ef`.
- **Keyboard navigation fallback in clickWorkspace (approach 2):** after `tryFiberClick` fails, now tries `Home` → `ArrowDown×N` → `Enter` dispatched to `document.activeElement`. Radix Select's keydown handler doesn't check `isTrusted`, unlike its pointer handlers. Synthetic pointer events demoted to approach 3. Not yet verified.
- **Usage popup scanner broadened:** added `[data-radix-popper-content-wrapper]`, `[data-radix-popover-content]`, `[data-state="open"]` to `scanForUsageExtras()` selector. Fixes missing 2h/3d reset times that stopped appearing.

**Project folder emoji migration:**
- 12 folders in `~/Documents/AI Projects/` renamed with emoji prefixes: 💼 🏗️ 🤝 💾 🦷 👗 💰 🏥 🎵 ⚙️ 🔄 ⏱️
- `.claude/projects/` directory names renamed to match. Encoding: each non-alphanumeric JS character in the path → one `-`; emoji that are surrogate pairs (JS length 2) → `--`; plus space = `---` total prefix after the base path separator. Verified empirically with `/tmp/🎯-emoji-test` → `-tmp----emoji-test`.
- `claude_desktop_config.json` permission entries updated to emoji paths (12 entries in `epitaxy-perm-mode-acks` and `epitaxy-folder-permission-mode`).
- `Claude Desktop` skipped — can't rename current working directory in-session.
- Haiku agent found 19 stale references across: `CLAUDE.md`, `claude_desktop_config.json`, `🏗️ Behi Blueprint/AGENTS.md`, `🏗️ Behi Blueprint/Integration.md`, `🎵 MyNoise Offline/agents.md`, `⏱️ Time Management/wiki.md`. All fixed.
- `claude-code-sessions/` JSON files contain old paths in historical session records — left as-is (correct: they record where sessions *were* opened).
- Residual `mynoise-offline/` directory (appeared post-rename, contains `user?submission=...`) confirmed by user as intentional — left in place.

**New file created:**
- `shortcuts.md` — complete keyboard shortcut reference for Claude Desktop, both built-in and custom. Includes the `Ctrl+;` side-chat shortcut discovered by user.

**agents.md overhauled** — full file registry, up-to-date feature state table with correct Ctrl+W entry.

### Decisions
- **Ctrl+W not Ctrl+Shift+W:** Ctrl+W was already wired in Claude Desktop but duplicated Ctrl+N (new session). Repurposing it avoids a chord that required three fingers; the cost (losing new-session shortcut) is zero since Ctrl+N exists.
- **Keyboard nav as approach 2, pointer events as approach 3:** Radix Select listens for `keydown` at document level without `isTrusted` checks; pointer handlers do check. So keyboard is more likely to work than synthetic mouse events even though it's slower (45ms × N presses).
- **Home key before ArrowDown:** ensures we always start from position 0 regardless of which item Radix highlights when opening, rather than trying to track current selection offset.
- **Don't update session history JSONs:** `claude-code-sessions/` files are audit records, not config. Updating them would falsify history. The active path is `claude_desktop_config.json`.
- **Skip `Claude Desktop` rename:** renaming the CWD mid-session would break all absolute-path tool calls. Handle in a fresh session opening a different project.

### Current state
All code changes deployed. New features (chat badges, Alt+1-9, Ctrl+W, overview hider) are in the asar — need one Claude Desktop restart to activate. Keyboard nav fallback for folder picker is the most uncertain addition; if it works, the folder click issue is finally resolved. Emoji migration complete except for `Claude Desktop` folder itself.

### Open threads
- [ ] Rename `Claude Desktop` → `🖥️ Claude Desktop` (do in a session opened from a different project; also update CLAUDE.md self-reference and claude_desktop_config.json)
- [ ] Restart Claude Desktop and verify: chat number badges, Alt+1-9, Ctrl+W, overview hidden
- [ ] Test workspace folder click with keyboard nav — open panel, click a folder, check if it selects. If not, `JSON.parse(localStorage.getItem('cc-ws-debug'))` for diagnostics
- [ ] Verify 2h/3d reset times now appear in the floating usage bar after opening the usage popup
- [ ] Still open from prior sessions: cache ring amber outline, Ctrl+1/2/3 nav, right panel tab selectors

## Session — 2026-06-17 (session 3)

### What happened

**Stale Claude Code sessions fixed:**
- 4 active sessions had missing `cwd` paths (folders renamed with emoji prefixes in prev session):
  `The Exchange` → `🔄 The Exchange`, `Comprehensive_Backup` → `💾 Comprehensive Backup`,
  `Behi_blueprint` → `🏗️ Behi Blueprint`, `Avande_Job` → `💼 Avande Job`
- Updated `cwd` + `originCwd` in their JSON files (`claude-code-sessions/…/*.json`)
- Set `isArchived: true` on all 4 — they're done, out of the way
- 8 other active sessions are fine (cwd still valid): `Activity Watch Feature Bounty`,
  `PC Manage/yazi`, `⏱️ Time Management`, `🤝 Claude Cowork`, `Claude Desktop`, `⚙️ PC Manager` ×2, `mynoise-offline`

**custom-ui.js v8 — new features:**
- **`emojiSuffix()` helper:** moves leading emoji to end of display name.
  "⏱️ Time Management" → "Time Management ⏱️" in the workspace panel.
  Applied in `buildColumn()` and the Files overlay in `switchRightPanelTab()`.
- **`window.__CC_FOLDERS__` runtime injection:** preload now reads `~/.config/Claude/cc-folders.json`
  via `require('fs')` at page-load time and injects the list before custom-ui.js runs.
  `rebuildPanel()` prefers this over the baked `CC_AI_LOCAL`. Folder renames now
  take effect after running `refresh-folders.sh` + navigating — no asar repack needed.
- **`refresh-folders.sh`:** new lightweight script (symlinked to `~/.config/Claude/` and
  `~/.local/bin/`). Updates `cc-folders.json` without touching the asar.
- **Rate-limit red ring:** `scanForRateLimit()` scans for "too many requests / temporarily
  limiting" text in the current chat. Tags chat ID in `cc-ratelimit` localStorage.
  `applyRings()` now renders a red outline (not amber) on rate-limited sidebar links.
  Clear manually: `localStorage.removeItem('cc-ratelimit')`.
- **Cache ring diagnostic:** `applyRings()` now writes one-time debug info to
  `cc-ring-diag` localStorage — found links, their href attributes, class names,
  current cache keys. Read via `JSON.parse(localStorage.getItem('cc-ring-diag'))`.
- **Folder picker updated:** re-ran `update-ui.sh` — `CC_AI_LOCAL` and `cc-folders.json`
  now reflect the 17 current folders including all emoji-prefixed names.

**update-ui.sh changes:**
- Now also writes `~/.config/Claude/cc-folders.json` as a side effect
- Custom-ui loader in mainView.js now reads the JSON via `require('fs')` at page-load

### Decisions
- **Note on session JSON update policy reversal:** previous session noted "don't update session history JSONs." Revisited: we updated `cwd`/`originCwd` so the FleetView can OPEN the session and show history; we didn't alter conversation content. The principle (don't falsify audit records) still holds — we only updated the folder path reference, which is operational metadata, not history.
- **`refresh-folders.sh` vs full `update-ui.sh` for folder changes:** `update-ui.sh` repacks the whole asar (~15s). For folder renames only, `refresh-folders.sh` writes a 1KB JSON file (~0.1s). Both are user-runnable without asking Claude.
- **`cc-folders.json` read at page-load not app-start:** the preload runs on each renderer page load (each navigation in Claude Desktop triggers a new execute call). So the JSON is re-read on each navigate, not just at app start. The workspace panel refreshes without restart.

### Current state
All changes deployed via update-ui.sh. Claude Desktop restart required to pick up v8.
After restart: 4 stale sessions will appear as archived (removed from active view).
Workspace panel will show emoji-at-end folder names.
Rate-limit red rings will activate next time a "too many requests" error appears in a chat.
Cache ring: still needs verification (diagnostic now available via cc-ring-diag key).

### Open threads
- [ ] Restart Claude Desktop and verify: emoji suffix in folder panel, rate-limit ring workflow
- [ ] Check `JSON.parse(localStorage.getItem('cc-ring-diag'))` after restart — report href format of sidebar links; may reveal why amber ring isn't showing
- [ ] Still open: Ctrl+1/2/3 nav shortcuts, right panel tab selectors, workspace folder click keyboard nav
- [ ] Rename `Claude Desktop` → `🖥️ Claude Desktop` (separate session, different project)

## Session — 2026-06-17 (session 4)

### What happened

**Floating usage pill — two fixes to `custom-ui.js`:**
- **Moved to bottom-right:** changed `position:fixed;top:6px;right:8px` → `position:fixed;bottom:8px;right:8px` in `updateFloatingBar()`. Pill no longer overlaps the top bar area.
- **Hidden on Code tab:** added `const onCodeTab = location.pathname.startsWith('/code')` check in `updateFloatingBar()`. Pill now only shows on Chat (`/`) and Cowork (`/cowork`) pages. Code tab has its own usage tracker in the toolbar.
- **Hours already present:** `fbarTime(_hourlyResetH, 'h')` was already in the floating bar on line 1239 — no change needed. User had added hours to the Code tab's built-in usage tracker independently; the pill was already showing hours via its own logic.

### Decisions
- **`startsWith('/code')` for detection:** simple, robust. The Code view's URL prefix is `/code`; chat is `/` or `/chat/...`; cowork is `/cowork`. No need to track tab state separately.
- **Don't add hours again:** the floating bar had its own `fbarTime(_hourlyResetH, 'h')` call independent of the Code tab tracker. Since both show hours, the user's edit to the Code tracker didn't affect the pill.

### Current state
Two-line diff to `custom-ui.js`. Needs `update-ui.sh` + Claude Desktop restart to deploy.

### Open threads
- [ ] Run `update-ui.sh` and restart Claude Desktop to pick up bottom-right pill + Code-tab hiding
- [ ] All prior open threads still pending: emoji suffix verify, rate-limit ring, cache ring diagnostic, Ctrl+1/2/3, right panel tabs, workspace folder click
- [ ] Rename `Claude Desktop` → `🖥️ Claude Desktop` (separate session)

## Session — 2026-06-18

### What happened
**Root-caused and fixed: NO custom UI elements were appearing at all.** The injection
was completely dead — not a feature bug, a loader bug.

- **Confirmed the right app was running:** patched electron at
  `~/.local/lib/claude-desktop-patched/...` (pid verified via `/proc/<pid>/exe`).
  App version is now **2.1.181** (was 1.9255.0).
- **Confirmed the preload is sandboxed:** the `mainView.js` `webPreferences` block in
  the main `index.js` sets neither `sandbox` nor `contextIsolation`, so Electron defaults
  apply (`sandbox:true`, `contextIsolation:true`). In that context `require('fs')` and
  `require('os')` are **unavailable** — exactly what CLAUDE.md's architecture note warned.
- **The bug (two parts):**
  1. The v8 loader's first statement was `var _fs=require('fs'),_hp=require('os')...` —
     placed **outside** the inner try/catch. The throw jumped straight to the outer
     `catch`, so `_inject()` / the `eval(_c)` never ran. Every UI feature was dead.
  2. The loader used `eval(_c)` (preload isolated world) instead of the documented
     `webFrame.executeJavaScript` (page main world).
- **The fix:** rewrote the loader template in `update-ui.sh` to:
  - drop `require('fs')`/`require('os')` entirely (folder list is already baked in as
    `CC_AI_LOCAL` at patch time),
  - inject via `require('electron').webFrame.executeJavaScript(_c)` — same mechanism the
    WCO topbar shim already uses successfully in this exact preload, so it's proven to work,
  - guard everything so a failure can never silently kill the injection.
- Re-baked the asar (`update-ui.sh`) and verified the embedded loader: uses
  `webFrame.executeJavaScript`, contains no `require('fs')`/`require('os')`, Ctrl+Q block intact.

### Decisions
- **`webFrame.executeJavaScript` over `eval`:** matches the documented design, runs in the
  page main world, and is the identical mechanism the WCO shim uses (proven working in the
  sandboxed preload). `eval` would run in the isolated world — fine for custom-ui.js's
  DOM/localStorage work, but a needless divergence.
- **Drop the runtime `cc-folders.json` read:** it can never work in a sandboxed preload
  (`require('fs')` throws). The baked `CC_AI_LOCAL` is sufficient; `update-ui.sh` re-reads
  the folder list on every run anyway. `refresh-folders.sh` is now defunct.
- **Diagnose, don't guess:** the first instinct (just re-run `update-ui.sh`) only re-baked
  the same broken template. The real fix required confirming the running binary + sandbox
  state before touching the loader.

### Current state
Loader is fixed and the asar is re-baked. custom-ui.js is unchanged (v8) — it was never the
problem. **Pending verification:** user must fully quit (not just close) Claude Desktop and
relaunch, then confirm the badges/panel appear. Console marker `[custom-ui] ok` on success;
`[custom-ui] <error>` would now mean a real error *inside* custom-ui.js (narrow, separate fix).

### Open threads
- [ ] **Verify the fix:** fully quit + relaunch; confirm usage badges + workspace panel render
- [ ] If console shows `[custom-ui] <error>`, that's a genuine custom-ui.js bug — debug from there
- [ ] Remove/retire `refresh-folders.sh` (defunct — preload no longer reads `cc-folders.json`)
- [ ] All prior open threads still pending: emoji suffix verify, rate-limit ring, cache ring
      diagnostic (`cc-ring-diag`), Ctrl+1/2/3 nav, right panel tabs, workspace folder click
- [ ] Rename `Claude Desktop` → `🖥️ Claude Desktop` (separate session)

## Session — 2026-06-18 (session 3)

### What happened

**Two usage pill bugs fixed in `custom-ui.js` — deployed via `update-ui.sh`:**

**Bug 1 — Pill showing on Code tab:**
- The existing blacklist `startsWith('/code')` was not reliably hiding the pill on the Code tab.
- Fix: replaced with an **explicit whitelist** — pill only shows when `pathname` is `/`, `/chat/…`, `/cowork…`, or `/new`. Anything else (Code, future routes) is hidden by default.
- Changed `_fbarEl.style.display = (anyKnown && !onCodeTab)` → `(anyKnown && onAllowedPage)`.

**Bug 2 — 2h/3d reset times not persisting:**
- Root cause: reset times (`_hourlyResetH`, `_weeklyResetD`) were computed once when the usage popup was open, stored as plain numbers (hours/days), and lost when the popup closed or on navigation.
- Additionally, `scanForUsageExtras()` scoped to specific Radix selectors — if the popup renders in an unmatched element, values are never scraped.
- Fix (three parts):
  1. **Store absolute timestamps instead of relative h/d:** `_hourlyResetMs` / `_weeklyResetMs` (ms epoch). `hoursUntil()` / `daysUntil()` compute display values live on every render from stored timestamps — so they age correctly without needing the popup open.
  2. **Persist to `localStorage['cc-reset-v1']`:** saved whenever a reset time is scraped; loaded on `bootstrap()`. Reset times survive popup close, navigation, and app restart (until the reset time passes).
  3. **Broaden popup scan:** `scanForUsageExtras()` now reads `document.body.innerText` (visibility-aware — hidden DOM excluded) when any popup/overlay is detected (`[data-state="open"]` etc.). Selector guessing eliminated; regex is now format-agnostic.

### Decisions
- **Whitelist over blacklist for pill visibility:** blacklists accumulate debt as new routes are added. Whitelist (`/`, `/chat`, `/cowork`, `/new`) is stable — the known good pages.
- **Absolute timestamp (ms) over relative h/d:** relative values go stale immediately after scraping; absolute timestamps age correctly for free. `localStorage` cost is negligible.
- **`document.body.innerText` over selector scan:** `innerText` respects CSS visibility so closed/hidden popups are excluded. Eliminates need to know Anthropic's Radix element hierarchy (which changes across versions). Only runs when at least one popup-like element is open (guard preserved for performance).
- **`resetTimestamp()` returns ms, not hours:** renamed `hoursUntilReset` → `resetTimestamp` to reflect the new return type; callers updated.

### Current state
Deployed via `update-ui.sh`. Needs Claude Desktop restart. After restart:
- Floating pill will disappear on the Code tab.
- Once usage popup is opened and `scanForUsageExtras()` scrapes reset times, `2h`/`3d` will persist across popup close and navigation (until the actual reset time passes).

### Open threads
- [ ] Restart Claude Desktop and verify pill is hidden on Code tab
- [ ] Open usage popup once — verify 2h/3d now appear and persist after closing popup
- [ ] `cc-reset-v1` in localStorage should be populated after first popup open
- [ ] Still open from prior sessions: emoji suffix verify, rate-limit ring, `cc-ring-diag`, Ctrl+1/2/3 nav, right panel tabs, workspace folder click, rename `Claude Desktop` → `🖥️ Claude Desktop`

## Session — 2026-06-18 (session 2)

### What happened
- **Alt+1-9 selector broadened:** was `nav a[href*="/chat/"], [data-sidebar] a[href*="/chat/"], aside a[href*="/chat/"]` — if Claude's sidebar doesn't render inside `<nav>`/`<aside>`/`[data-sidebar]`, no links were ever found. Changed to `a[href*="/chat/"]` filtered by `offsetParent` (same broad scan that `applyChatNumbers()` already uses). Also changed key detection to use `parseInt(e.key)` with `e.code` (`'Digit1'`–`'Digit9'`) as fallback for non-QWERTY keyboard layouts.
- **Cache ring clarified:** user questioned the teal color. Confirmed it was always the cache ring (`applyRings()` uses `#06b6d4`). The ring shows when a chat was visited within the last 5 minutes, indicating the prompt cache may still be warm. Working as designed.
- **Workspace panel dark mode fix (3 layers):**
  1. `background:#f5f4ef` → `background:var(--bg-100,#f5f4ef)` — uses Claude's own dark-mode CSS variable
  2. `border:1px solid rgba(0,0,0,.15)` → `border:1px solid var(--claude-border,rgba(128,128,128,.22))` — visible in both modes
  3. Added `@media (prefers-color-scheme:dark)` block in injected CSS: forces `.cc-ws-panel { background:#28261f; border-color:rgba(255,255,255,.12) }` as hard fallback if vars don't exist
  4. Item hover highlight: `rgba(0,0,0,.07)` → `var(--bg-200,rgba(128,128,128,.15))` — visible on dark backgrounds
- All changes deployed via `update-ui.sh`.

### Decisions
- **Broadened selector over adding debug logging:** since `applyChatNumbers()` uses the same narrow selector and numbers were showing, the selector mismatch was the most likely cause. Broadening to match the number badge logic keeps them consistent.
- **3-layer dark mode approach:** inline styles can't use `prefers-color-scheme` media queries; CSS classes can. The `@media` block in `injectBaseCSS()` overrides per-element inline styles with `!important`, which is the only way to win over them.
- **Cache ring color stays teal (#06b6d4):** distinct from error (red), hourly badge (amber/yellow), and weekly badge (green). Teal = "informational / recently warm." No change needed.

### Current state
Changes deployed to asar. Restart Claude Desktop to pick up: broadened Alt+1-9 selector, dark mode panel colors, updated hover highlight.

### Open threads
- [ ] Verify Alt+1-9 works after restart
- [ ] Verify workspace panel looks correct in dark mode
- [ ] Still open: emoji suffix verify, rate-limit ring, `cc-ring-diag` inspection, Ctrl+1/2/3 nav, right panel tabs, workspace folder click keyboard nav
- [ ] Rename `Claude Desktop` → `🖥️ Claude Desktop` (separate session)
