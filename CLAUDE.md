# Claude Desktop -- Custom UI Patches

Patches for the Claude Desktop Electron app via preload injection.

- **Patched app:** `~/.local/lib/claude-desktop-patched/`
- **Original AppImage:** `/opt/claude-desktop/claude-desktop.AppImage` (untouched, installed via AUR package `claude-desktop-appimage`)
- **Patched app version:** 3.2.1+claude1.24012.9 | **custom-ui.js:** v18
- **GitHub:** https://github.com/behdadmansouri/claude-desktop-tweaks

> **2026-07-12 scope trim:** stripped down to the one feature actually in use - the project
> selector panel (`workspace.js`). Deleted `sidebar.js`, `fbar.js`, `topbar.js`, `usage.js`,
> `banners.js` (verified dead: every function in them was only reachable from commented-out
> calls). The two live one-liners they held (`emojiSuffix`, `_seenDialogs`) moved into
> `workspace.js`. Also reverted the topbar/WCO padding-collapse CSS and `patchWCOHeight()` --
> both were compensating for the old hybrid-titlebar shim, which the v3.0.0 rebase removed;
> `patchWCOHeight()` was already a guaranteed no-op post-rebase (`navigator.windowControlsOverlay`
> doesn't exist in the new build). Native topbar spacing now used as-is.

> **2026-07-12 v3.0.0 packaging rebase (see `memory/maintenance.md`):** aaddrick's packager switched
> to repackaging Anthropic's official Linux Electron build. Layout changed: asar moved to
> `usr/lib/claude-desktop/resources/app.asar`; main-process code is a content-hashed chunk file
> (name changes every release, located by content signature in `update-ui.sh`, not by name); the
> old WCO/frame-fix JS shim is gone (official build handles the window frame natively); IPC channel
> names embed a per-build UUID extracted dynamically at patch time. Old `~/.local/share/claude/versions/`
> self-update mechanism is gone -- updates now come via the AUR package (`yay -S claude-desktop-appimage`).
> The new launcher auto-detects the actual Chromium GPU-FATAL crash signature and only disables GPU
> when it's actually happened (sticky), so the blanket `CLAUDE_DISABLE_GPU=1` .desktop workaround was
> removed -- GPU acceleration is back on by default with automatic crash fallback.

> **2026-07 blank-page gotchas (see `memory/issues-fixed.md` #17/#18):**
> 1. Blank + crash = Chromium GPU FATAL (#583), now handled automatically by the launcher (see above).
> 2. New home route is `/epitaxy`; it reuses `data-top-left` on a whole-app container, so the
>    top-bar hider blanked the page. The top-bar hider is now removed entirely (native top bar
>    looks correct, no reason to hide it); the overview hider is still DISABLED pending rework.
> - A GUI launch from a non-interactive agent bash session can't open on the user's Wayland seat -
>   have the user launch from the menu; read `~/.config/Claude/logs/claude.ai-web.log` for diagnostics.

> **2026-06 dframe sidebar:** Chat rows are now `<div data-row>` + `<button data-row-main-button>`.
> No chat ID in the DOM. All chat-keyed features key on chat **title** (from the "More options"
> button aria-label). Active chat has `data-selected`. See `memory/architecture.md` for full detail.

---

## Architecture

```
Claude Desktop (Electron)
├── Main process  -- .vite/build/index.chunk-*.js  <- PATCHED (folder-picker default + cc-ai-data IPC)
│                     (content-hashed filename, located by signature in update-ui.sh, not by name)
├── Preload       -- mainView.js  <- PATCHED
│   ├── Sandboxed: only require('electron') works
│   └── Injects via webFrame.executeJavaScript() into main world
└── Renderer      -- claude.ai (main world)
    └── custom-ui.js runs here (full DOM + localStorage)
         -- just the project selector panel now; see File Registry
```

Preload is sandboxed -- custom code must be embedded at patch time by `update-ui.sh`.

### Two apps installed side by side (2026-08-09)

Anthropic's **official** Linux app (beta, Debian/Ubuntu `.deb` only) is now also installed,
unpatched and independent:

| | Patched (daily driver) | Official |
|---|---|---|
| Prefix | `~/.local/lib/claude-desktop-patched` | `~/.local/lib/claude-desktop-official` |
| Profile | `~/.config/Claude` | `~/.config/ClaudeOfficial` |
| Version | 1.24012.9 | 1.26832.0 |
| Custom UI | yes | **no** (no project panel, no titlewatch) |
| `claude://` handler | yes | deliberately not registered |
| Update | `scripts/update-appimage.sh` | `scripts/install-official.sh` |

They cannot coexist as *packages* -- `claude-desktop-appimage` declares
`provides/conflicts=claude-desktop`, and AUR `claude-desktop` / `claude-desktop-extra` would
remove it. Hence the manual prefix install. Both are Electron appName `Claude`, so the official
one is pinned to a separate profile with `--user-data-dir`; sharing one profile between two
Electron processes risks LevelDB corruption.

---

## File Registry

| File | Purpose |
|------|---------|
| `custom-ui/css.js` | Base CSS injection (sidebar leading-slot spacing, dark-mode workspace-panel override) |
| `custom-ui/workspace.js` | The project selector panel: folder click, markdown TODO.md preview, `emojiSuffix`, `_seenDialogs` |
| `custom-ui/bootstrap.js` | Scan loop + bootstrap (just calls `injectBaseCSS` + `installPanel`) |
| `custom-ui/titlewatch.js` | Sets `document.title` to the active session/conversation title so outside tools can read it. The app resets it to "Claude" on navigation, so it re-applies on a MutationObserver. Debug with `window.__ccTitleDebug()` in DevTools. Consumed by the Timekeeper project's ActivityWatch window watcher, which otherwise only ever sees the window titled "Claude" |
| `custom-ui.js` | Build artifact -- generated by `update-ui.sh` from modules above |
| `scripts/update-ui.sh` | Patch + deploy tool |
| `scripts/update-appimage.sh` | Updates the AUR package + re-extracts + re-patches in one go (calls `update-ui.sh`) |
| `scripts/install-official.sh` | Installs/updates Anthropic's **official** Linux app into `~/.local/lib/claude-desktop-official` on an isolated profile, side by side with the patched build. Does not touch it. |
| `scripts/claude-quit.sh` | Kill all Claude processes |
| `memory/architecture.md` | Patching stack, titlebar, preload sandbox, IPC details |
| `memory/features.md` | Feature status (implemented / partial / not yet) |
| `memory/debugging.md` | Console markers, log files, localStorage state, constraints |
| `memory/design-decisions.md` | Whitelist guards, absolute timestamps, DOM scanner patterns |
| `memory/maintenance.md` | Deploy workflow, folder renames, AppImage upgrades |
| `memory/issues-fixed.md` | Bug history (18 issues) |
| `memory/perf-security.md` | Security and performance review |

---

## Quick Start

```bash
# 1. Edit the relevant module in custom-ui/  (see File Registry above)
# 2. Re-patch and deploy
./scripts/update-ui.sh
# 3. Fully quit and restart
~/.local/bin/claude-quit
```
