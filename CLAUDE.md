# Claude Desktop — Custom UI Patches

Custom UI injection and patches for the Claude Desktop Electron app. This folder owns all customizations applied via preload patching.

---

## Overview

Claude Desktop ships as an AppImage at `/opt/claude-desktop/`. We extract it, patch the compiled JavaScript inside the `.asar` bundle, and run the patched version from a permanent directory. The original AppImage is never modified.

- **Patched app location:** `~/.local/lib/claude-desktop-patched/`
- **Original AppImage:** `/opt/claude-desktop/claude-desktop.AppImage` (untouched)
- **App version:** 2.1.181 (electron resources)
- **custom-ui.js version:** v8
- **GitHub repo:** https://github.com/behdadmansouri/claude-desktop-tweaks

---

## Architecture

```
Claude Desktop (Electron)
├── Main process  — index.js  (not patched)
├── Preload       — mainView.js  ← WE PATCH THIS
│   ├── Runs sandboxed: only require('electron') works
│   ├── NO access to require('fs'), require('path'), etc.
│   └── Injects via webFrame.executeJavaScript() into main world
└── Renderer      — claude.ai (main world)
    └── custom-ui.js runs here with full DOM + localStorage access
```

**Key constraint:** the preload is **sandboxed** (Electron defaults). Custom code must be embedded at patch time by `update-ui.sh` — can't read files at runtime.

**Titlebar mode:** hybrid (native KDE decorations + in-app topbar via WCO shim).

---

## File Registry

| File | Purpose |
|------|---------|
| `custom-ui.js` | Main injection script — all UI features live here |
| `scripts/update-ui.sh` | Patch & deploy tool; embeds custom-ui.js into asar and rewrites mainView.js |
| `scripts/claude-quit.sh` | Kill all Claude processes (fallback to Ctrl+Q) |
| `scripts/cdp-debug.py` | CDP helper (non-functional since v1.9255.0 — kept for reference) |
| `scripts/install.sh` | Installation helper for Linux |
| `scripts/install.ps1` | Installation helper for Windows |
| `README.md` | Project overview and quickstart |
| `CLAUDE.md` | This file — architecture, how to patch, known issues |
| `wiki.md` | Running session log — discoveries, fixes, decisions |
| `shortcuts.md` | Keyboard shortcut reference (built-in + custom) |
| `TODO.md` | Feature implementation status and outstanding work |

---

## Quick Start: Making Changes

```bash
# 1. Edit the main injection script
code custom-ui.js

# 2. Re-patch and deploy
./scripts/update-ui.sh

# 3. Fully quit and restart Claude Desktop
~/.local/bin/claude-quit
# Then launch from app menu or: ~/.local/lib/claude-desktop-patched/AppRun &
```

After `update-ui.sh`, changes take effect on restart — no rebuild needed.

---

## Patched files inside the asar

### `.vite/build/mainView.js` (preload)
Three sections appended before `//# sourceMappingURL`:

1. **WCO topbar shim** — fakes `navigator.windowControlsOverlay` so claude.ai renders its in-app topbar (40px height reported to React)
2. **`// ── custom-ui loader`** — reads `custom-ui.js` (embedded as JSON string), injects via `webFrame.executeJavaScript()` after DOMContentLoaded
3. **`// ── Ctrl+Q to quit`** — keydown listener calling `WindowControl_close` IPC

### `launcher-common.sh` (outside asar)
- Password store: `kwallet6` (KDE Plasma 6)
- Ozone platform: `x11` (XWayland — for global hotkey support)
- `--remote-debugging-port` **removed** (breaks app since v1.9255.0 due to security check)
- Close-to-tray: ON

---

## Custom UI Features — Current State

### Implemented ✅

| Feature | Status | Notes |
|---------|--------|-------|
| **Usage badges** `C35% H81% 2h W45% 3d` | ✅ | Context/hourly/weekly % + reset times (persist via `cc-reset-v1`) |
| **Top bar hidden** | ✅ | CSS rule + WCO shim patch reporting 0px height + `resize` event |
| **Ctrl+O** search | ✅ | Keyboard shortcut |
| **Ctrl+Q** quit | ✅ | Clean shutdown via IPC |
| **Ctrl+Shift+L** sidebar toggle | ✅ | 4-strategy fallback detection (CSS, aria-label, data-testid, Ctrl+\) |
| **Ctrl+Shift+R** right panel toggle | ✅ | Hide/show artifact panel |
| **Ctrl+W** close file viewer | ✅ | Repurposed (was redundant with Ctrl+N) |
| **Chat number badges** (1–9) | ✅ | Small numbers before first 9 chats in sidebar |
| **Alt+1-9** jump to Nth chat | ✅ | Broadened selector; fallback via `e.code` for non-QWERTY layouts |
| **Workspace panel** | ✅ | Hover-triggered; Local column baked from `~/Documents/AI Projects/` at patch time |
| **Workspace folder click** | ✅ | Multi-strategy: fiber click → keyboard nav (Home/ArrowDown/Enter) fallback |
| **Cache ring** (teal outline) | ✅ | 5-min TTL on warm-cache chats; detected via activity timestamp in `cc-cache-v4` |
| **Rate-limit ring** (red outline) | ✅ | Detects "too many requests" text in chat; persists in `cc-ratelimit` |
| **Pin chats** (📌 button) | ✅ | Hover button on sidebar; amber outline on pinned chats |
| **Startup popup auto-dismiss** | ✅ | Single-button dialogs + "Attach debugger?" → auto-Cancel |
| **"Model unavailable" banner hidden** | ✅ | Text scan + `display:none` on parent banner |
| **New-session overview hidden** | ✅ | Hides canvas + overview; re-enable: `localStorage.ccShowOverview='1'` |
| **Code tab auto-select** | ✅ | When artifact panel appears, auto-clicks Code tab |

### Partially Working ⚠️

| Feature | Status | Notes |
|---------|--------|-------|
| **Ctrl+1/2/3** Chat/Cowork/Code | ⚠️ | Added 2026-06-16; nav element selectors may need tuning |
| **Right panel tabs** | ⚠️ | Selector `[data-testid="artifact-panel"]` unverified in latest version |

### Not Yet Implemented ❌

| Feature | Status | Notes |
|---------|--------|-------|
| **Weekly usage circle** | ❌ | Data not reliably available in DOM; skipped in favor of floating bar |
| **Workspace "New Project on SSH"** | ❌ | Requires main-process IPC to create remote directory (out of scope) |
| **KDE native titlebar hiding** | ❌ | Use KDE Window Rules to hide per-app (system-level, not renderer) |

---

## Known Issues (Fixed)

All issues from v1–v8 have been identified and fixed. See `wiki.md` for detailed session logs documenting:

- **v6–v7:** Negative space, dframe layout, cache ring visibility, reset time persistence, workspace panel dark mode
- **v8:** **Critical loader bug fix** — preload was calling `require('fs')` outside try/catch (throwing in sandboxed context, killing entire injection). Rewritten to drop file reads and use `webFrame.executeJavaScript()` (proven mechanism from WCO shim).

Current state: no known active issues.

---

## Debugging

### Console markers
```js
// After page load, check console for:
"[custom-ui] ok"        // injection succeeded
"[custom-ui] <error>"   // genuine custom-ui.js error
```

### Persisted state (localStorage)
```js
JSON.parse(localStorage.getItem('cc-reset-v1'))      // reset times {hourly: ms, weekly: ms}
JSON.parse(localStorage.getItem('cc-cache-v4'))      // warm-cache chat IDs + timestamps
JSON.parse(localStorage.getItem('cc-ratelimit'))     // rate-limited chat IDs
JSON.parse(localStorage.getItem('cc-ring-diag'))     // one-time cache/ratelimit ring scan results
JSON.parse(localStorage.getItem('cc-ws-debug'))      // last workspace folder click attempt
localStorage.getItem('cc-debug')                     // topbar detection strategy
```

### Log files
```
~/.config/Claude/logs/main.log              — main process log
~/.config/Claude/logs/main-window.log       — preload/renderer log
~/.config/Claude/logs/claude.ai-web.log     — React errors
~/.cache/claude-desktop-debian/launcher.log — shell launcher log
```

### Clearing UI state
```js
// Re-enable the new-session overview
localStorage.setItem('ccShowOverview', '1'); location.reload();

// Clear rate-limit red rings
localStorage.removeItem('cc-ratelimit'); location.reload();

// Clear all cache tracking
localStorage.removeItem('cc-cache-v4'); location.reload();
```

---

## Self-service: Folder Renames

After renaming/adding/removing folders in `~/Documents/AI Projects/`:

```bash
./scripts/update-ui.sh   # re-bakes CC_AI_LOCAL into the asar
```

Then fully quit + relaunch Claude Desktop. The workspace panel reads the baked folder list.

---

## How to Update After Claude Desktop Releases

When Anthropic ships a new AppImage version:

1. The AppImage at `/opt/claude-desktop/` updates automatically
2. Our patched copy at `~/.local/lib/claude-desktop-patched/` is untouched
3. To pick up the new version, extract and re-patch:

```bash
cd /tmp
/opt/claude-desktop/claude-desktop.AppImage --appimage-extract
mkdir -p claude-app-new
npx @electron/asar extract squashfs-root/usr/lib/node_modules/electron/dist/resources/app.asar claude-app-new

# Then re-apply preload patches (see update-ui.sh for exact changes)
# to .vite/build/mainView.js:
#   1. WCO topbar shim
#   2. custom-ui loader
#   3. Ctrl+Q handler

~/Documents/AI\ Projects/Claude\ Desktop/scripts/update-ui.sh  # re-patch and deploy
```

---

## Constraints & Limitations

| Constraint | Reason | Workaround |
|-----------|--------|-----------|
| Preload sandboxed | Electron security model | Embed data at patch time (folders, config) |
| No `require('fs')` in preload | Renderer isolation | Bake folder list into asar via `update-ui.sh` |
| No CDP debugging | Security check in v1.9255.0+ | Use `update-ui.sh` + restart to test changes |
| Workspace click via pointer | Radix UI checks `isTrusted` | Keyboard nav fallback (Home → ArrowDown → Enter) |
| No preload hot-reload | Electron design | Must fully quit and restart app |

---

## Maintenance

**Update frequency:** As needed when Claude Desktop releases new versions or when new features are desired.

**Testing:** After any change, run `./scripts/update-ui.sh`, fully quit the app, restart, and verify the feature works in the console (`[custom-ui] ok` marker) and visually.

**Breaking changes:** None expected. The injection is designed to fail gracefully if custom-ui.js has errors (caught and logged, doesn't kill the app).
