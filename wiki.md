# Claude Desktop Patching — Session Wiki

## Current state (as of 2026-06-13)

App version: **1.9255.0** (`isPackaged: true` via AppRun)
custom-ui.js: **v7**
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
- **Status: Working (v6)**
- Red ring on conversation title links active within the last 5 minutes
- `box-shadow: 0 0 0 2px #ef4444; border-radius: 6px` on `a[href*="/chat/"]`
- TTL: 5 minutes; storage: `cc-cache-v4`

### Feature 10: Quick workspace panel
- **Status: Working (v6, improved v7)**
- Two-column floating panel (Local | Myserver) on new-session pages
- Folder click uses `fireClick()` + `waitNewMenu()` (new menu detection only, no global fallback)
- Stores up to 40 entries in `cc-ws-v4`

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
