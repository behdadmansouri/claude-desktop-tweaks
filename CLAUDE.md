# Claude Desktop -- Custom UI Patches

Patches for the Claude Desktop Electron app via preload injection.

- **Patched app:** `~/.local/lib/claude-desktop-patched/`
- **Original AppImage:** `/opt/claude-desktop/claude-desktop.AppImage` (untouched, installed via AUR package `claude-desktop-appimage`)
- **Patched app version:** 3.2.1+claude1.24012.9 | **custom-ui.js:** v19
- **GitHub:** https://github.com/behdadmansouri/claude-desktop-tweaks

> **2026-09-01 - the official build is the daily driver, and it patches like anything else:**
> `update-ui.sh --official` gives Anthropic's own Linux build everything the patched one has. Two
> assumptions had to go first, and both are now permanent rules for anything that matches on
> content: **the main process is many chunks, not one** (each site is located across every file in
> `.vite/build` by `patch_every`, and only changed chunks are written and `node --check`ed), and
> **no signature may spell a quote character** - this build's minifier emits template literals, so
> use `QUOTE`, built from `chr(96)` because a literal backtick in that heredoc is a command.
> `install-official.sh` re-applies the patch itself now, since it replaces the whole prefix, and
> shouts (plus a desktop notification) rather than leaving a normal-looking unpatched app;
> `--no-patch` opts out. `claude-ctl` and the session-start check report **both** builds, each of
> the four main-process patches per build. Post-mortem, including a browseFolder regex that could
> never have matched: `memory/issues-fixed.md` #51.
>
> **2026-08-25 (later) - control surface, native frame, and what is actually shared:** `claude-ctl`
> is now the one place to see and change state (`scripts/claude-ctl.sh`, plus a generated
> `dashboard.html`), and `install-autoupdate.sh` keeps both builds current on a systemd --user
> timer that **refuses to act while the app is running** - it works the window after you quit.
> The main window was created `titleBarStyle:"hidden"`, i.e. frameless on Linux with the app
> drawing its own controls; it is now `"default"` there, so KWin decorates it. Matched on the
> `minWidth:600,minHeight:400` signature, because the *other* `titleBarStyle:"hidden"` is the Quick
> Entry overlay and must stay frameless.
>
> **What is and is not shared between the two builds** (measured, not assumed): claude.ai chats are
> server-side; Claude Code **transcripts already are** shared - the desktop's Code tab *is* Claude
> Code, each record carries a `cliSessionId` that is a real `~/.claude/projects/<slug>/<uuid>.jsonl`.
> The only gap is the desktop's own session **index**, which is what `share-sessions.sh` symlinks.
> Running both builds at once against it is **fine** - every record is a separate per-session file;
> the entire race surface is one shared `scheduled-tasks.json`. The CLI has no index at all (it
> scans `~/.claude/projects`), which is why N terminal tabs never race and why there is nothing to
> link in that direction.
>
> **2026-08-25 - the DOM stopped carrying names, and sleep was never work-aware:** menu rows lost
> their `textContent` in the 08-22 build (`items:["","Cloud","Remote Control","SSH"]` in every
> `[cc-ws-debug]` line since). Everything keyed on text went blind at once: the current connection
> read `""`, so the panel drove the connection menu on **every** click including Local→Local (the
> slowness), no connection could be matched (the stuck host stage), and `sameItem` compared `""` to
> `""` and would commit on any row. All of it now goes through `labelsOf()` / `bestLabel()`, which
> read every label source and score the best. Sleep: the app claims `powerSaveBlocker` once at
> startup whenever `keepAwakeEnabled` is true - a pref that defaults to false and gets flipped on
> for you - and holds it until quit; `update-ui.sh` now gates that claim on recent session-file
> activity (`CC_KEEPAWAKE_IDLE_MIN`, default 30). Also: per-project open-TODO counts on the tiles,
> geometry-only sidebar detection for the usage chip, `update-ui.sh --official`, and
> `scripts/share-sessions.sh`. Details: `memory/issues-fixed.md` #41-45.
>
> **`custom-ui/workspace.js` used to contain a literal NUL byte**, which made `grep` treat it as
> binary and print nothing, silently, for a file full of matches. Stripped; keep it that way.
>
> **2026-08-21 (later) - stacking, switching, servers, window title:** the panel no longer hides
> itself; it just sits at `z-index:30`, over page content and under the app's Radix overlays. It is
> also floored at the workspace row's left edge so it can't cover the sidebar on a narrow window
> (same treatment for the floating usage chip, via `cuSidebarRight()`). Project switching: the
> connection menu was being driven on *every* click because `currentConn` never read, and the
> 08-21 dedupe had dropped the "Local" row - both fixed. SSH hosts live in a **submenu**, and their
> display names differ from their ssh targets (`Myserver`→`myserver`, `MyHostinger`→`root@…`); the
> Remote column now merges `cc-ws-v4` + the app's own `desktop-recent-workspaces` + every host in
> `~/.config/Claude/ssh_configs.json`, and each host heading opens an ssh file browser. New:
> **ctrl+shift+F** opens a file/folder browser in the panel (the app's own is gated to started
> sessions). ActivityWatch: the KWin watcher was fine, Electron just wasn't mirroring `document.title`
> onto the window - `cc-set-title` does it directly. Details: `memory/issues-fixed.md` #36-40.
>
> **`scripts/update-ui.sh`'s python heredoc is UNQUOTED - comments in it are code.** No backticks,
> no `$(`, no backslash escapes. Both rules were learned the hard way; see the maintenance note at
> the end of `memory/issues-fixed.md` for the scan command.

> **2026-08-21 panel overhaul + two chip fixes:** the project panel no longer fights the app for
> the top of the stack - it hides itself whenever a native dialog/menu is open (`applyPanelVisibility`),
> which is what makes Settings usable again. Clicking a project now **pins** its TODO preview
> (`unpin` in the preview header releases it), the columns have a real 22px gutter, names have an
> emoji/short/full radio, the preview pane can open any `.md`/`.txt` in the folder, and remote
> folders preview over ssh. Panel size now scales with the window. Also fixed: menu navigation
> committed by index and could open the wrong project; `sampleWS()` had been missing since July, so
> nothing had recorded a remote folder in months. Details: `memory/issues-fixed.md` #30-35.
>
> Background update check runs at session start (`scripts/check-updates.sh`, wired via a
> SessionStart hook in `.claude/settings.json`). It reports and never installs.

> **2026-08-18 usage rebuild + panel geometry fix:** `usage.js` is back, rewritten against the
> app's own `/api/organizations/<org>/usage` endpoint rather than the usage popover's DOM (the old
> one could not be live by construction). The project panel is now a fixed-size two-pane box on
> `<body>`, which is what actually fixes the hover jitter and the zoom cropping. Details:
> `memory/issues-fixed.md` #22-25, endpoint shape in `memory/architecture.md`.

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

| | Patched | Official (daily driver) |
|---|---|---|
| Prefix | `~/.local/lib/claude-desktop-patched` | `~/.local/lib/claude-desktop-official` |
| Profile | `~/.config/Claude` | `~/.config/ClaudeOfficial` |
| Version | 1.24012.9 | 1.26832.0 |
| Custom UI | yes | **yes**, since 2026-09-01 |
| `claude://` handler | yes | still not registered (would take it off the patched build) |
| Update | **none** - `scripts/update-appimage.sh` is broken, the AUR package was removed 2026-08-14 (see `memory/maintenance.md`) | `scripts/install-official.sh`, which re-applies the custom UI itself |

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
| `custom-ui/workspace.js` | The project selector panel: two-pane box sized from the viewport, folder click, pinned markdown preview of any `.md`/`.txt` in the folder (local via IPC, remote via ssh), emoji/short/full name modes, yields to the app's own dialogs, `emojiSuffix`, `_seenDialogs` |
| `custom-ui/session.js` | What the current route is a session *of*: project folder, title, model, and the last turn's token count, via the `cc-session-info` IPC (the app's own session record + the transcript tail). One cache shared by the title watcher and the usage chip |
| `custom-ui/labels.js` | Puts the folder's emoji back on sidebar project groups that the app names after a git remote (`label:project-owner/repo`) instead of after their folder. Map baked from each folder's `.git/config` by `update-ui.sh` as `CC_AI_REPOS`; `cc-repo-emoji=0` disables |
| `custom-ui/usage.js` | Live usage chip (context / 5-hour / weekly + time to reset). Polls `/api/organizations/<org>/usage` - the app's own tray-usage endpoint - instead of scraping the popover, which is why it can actually stay current. Debug with `window.__ccUsage()`. Endpoint + payload shape: `memory/architecture.md` |
| `custom-ui/chrome.js` | Hides the in-app top bar (back/forward/search/sidebar-toggle) to reclaim ~44px. Matches on geometry only, never an attribute - and reverts itself if hiding collapses the page's visible text. `window.__ccTopbar.show()` to put it back |
| `custom-ui/diag.js` | DOM beacon. CDP is blocked, so this is how a selector gets *measured* instead of guessed: one JSON line to the renderer log with usage buttons, top-bar drag regions, what constrains the chat column's width, and any limit nags. `window.__ccDump()`, or automatically 6s after load unless `localStorage['cc-diag']='0'` |
| `custom-ui/bootstrap.js` | Scan loop + bootstrap (`injectBaseCSS` + `installUsage` + `dgBootstrap` + `installPanel` + `dismissLimitNags`) |
| `custom-ui/titlewatch.js` | Sets `document.title` to the project folder plus the active session/conversation title (`Claude Desktop 🤖 · Sidebar emoji fix`) so outside tools can read it. The app resets it to "Claude" on navigation, so it re-applies on a MutationObserver. Debug with `window.__ccTitleDebug()` in DevTools. Consumed by the Timekeeper project's ActivityWatch window watcher, which otherwise only ever sees the window titled "Claude" |
| `custom-ui.js` | Build artifact -- generated by `update-ui.sh` from modules above |
| `scripts/update-ui.sh` | Patch + deploy tool. `--official` targets the official build instead, `--prefix DIR` anything else. Also makes "keep computer awake" mean *while working*: it rewrites the app's `keepAwakeEnabled` claim to consult `__ccWorkActive()` and re-checks every 60s |
| `scripts/claude-ctl.sh` | **The control surface.** `claude-ctl` (on PATH via `~/.local/bin`) shows versions, which build is running, which main-process patches are applied, patch freshness, session sharing, and every power/lock inhibitor KDE currently holds. Also acts: `patch`, `update`, `share`/`unshare`, `quit`, `json`, `page` |
| `scripts/render-dashboard.py` | Renders `claude-ctl json` into a self-contained `dashboard.html` (no server, no network, light+dark). Separate file, not a heredoc, precisely because of the heredoc hazard below |
| `scripts/install-autoupdate.sh` | systemd **--user** timer that runs `claude-ctl update` every 2h. Never passes `--force`, so it does nothing while the app is running - it acts in the window after you quit. `--status` / `--remove` |
| `scripts/share-sessions.sh` | Points the official build's Code-tab session index at the patched profile's, so both show the same sessions. Only `claude-code-sessions/` is linked - transcripts are already shared. `--undo` reverses it |
| `scripts/check-updates.sh` | Background update check: official build vs the apt index, the patched build vs the AUR, and whether the deployed asar is stale relative to `custom-ui/`. `--report` prints the last result offline. Reports only - never installs. Run at session start by the hook in `.claude/settings.json` |
| `scripts/update-appimage.sh` | Updates the AUR package + re-extracts + re-patches in one go (calls `update-ui.sh`) |
| `scripts/install-official.sh` | Installs/updates Anthropic's **official** Linux app into `~/.local/lib/claude-desktop-official` on an isolated profile, side by side with the patched build. Does not touch it. |
| `scripts/claude-quit.sh` | Kill all Claude processes |
| `memory/architecture.md` | Patching stack, titlebar, preload sandbox, IPC details |
| `memory/features.md` | Feature status (implemented / partial / not yet) |
| `memory/debugging.md` | Console markers, log files, localStorage state, constraints |
| `memory/design-decisions.md` | Whitelist guards, absolute timestamps, DOM scanner patterns |
| `memory/maintenance.md` | Deploy workflow, folder renames, AppImage upgrades |
| `memory/issues-fixed.md` | Bug history (50 entries), each with symptom, root cause, fix and the lesson |
| `USAGE.md` | The operator's page: `claude-ctl`, the autoupdate timer, the patch loop, session sharing, and where to look when something breaks |
| `memory/todo-archive.md` | Detail trimmed out of `TODO.md` when items were shortened. Not read unless a short item needs unpacking |
| `memory/changelog.md` | Dated, append-only record of what shipped, in order. Post-mortems stay in `issues-fixed.md` |
| `memory/perf-security.md` | Security and performance review |
| `docs/review-2026-08.md` | Fleet review 2026-08-26: patch brittleness vs upstream, the stranded untrack commit / unpushed-bundle risk, update-path verdict, convention drift |

`memory/` stays flat past the usual ~8-file threshold on purpose: half of it is harness-owned auto-memory (`MEMORY.md` plus the `project_*.md` atoms it indexes with relative links, symlinked in from `~/.claude/projects/`), which cannot be moved into subfolders without breaking that index. The eight hand-written docs above are the only part that is ours to group, and eight is the threshold, not past it.

---

## Quick Start

```bash
# 1. Edit the relevant module in custom-ui/  (see File Registry above)
# 2. Re-patch and deploy
./scripts/update-ui.sh
# 3. Fully quit and restart
~/.local/bin/claude-quit
```
