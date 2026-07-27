# Claude Desktop — TODO & Feature Status

## Implemented ✅

**Keyboard shortcuts** — Ctrl+Q (quit), Ctrl+O (search), Ctrl+Shift+L (toggle sidebar),
Ctrl+Shift+R (Files panel / open project folder), Ctrl+W (close viewer), Alt+1-9 (jump to
Nth chat), Ctrl+1/2/3 (Chat/Cowork/Code). Ctrl+Shift+F is left to native handling (session
context-menu).

**Usage** — badges (`C35% H81% 2h W45% 3d`), reset times persist (`cc-reset-v1`), auto-refresh
after a reply and passively while idle. Emoji suffix on folder names.

**Sidebar** — chat number badges (solid digit chip, 1-9), pin chats (📌, amber outline), cache
ring (teal, 5-min TTL), rate-limit ring (red, auto-clears on next reply, `cc-ratelimit`).

**Workspace panel** — Local (from `~/Documents/AI Projects/` via `cc-ai-data` IPC) + SSH recents
columns, hover-triggered, 2-column grid when >4 items, TODO.md markdown previews, folder click opens
directly via `ccBridge.openFolder`, solid background, responsive width, dark mode.

**Dialogs/banners** — startup popup auto-dismiss, "Attach debugger?" auto-cancel, "Model unavailable"
banner hidden. Code tab auto-select in artifact panel. dframe layout fixes.

---

## Open Threads 📋

- [ ] **Duplicate "close right bar" buttons in Cowork** — two floating close buttons appear at
      once. Needs live DOM inspection next time it's visible (devtools or a screenshot) before
      attempting a fix — no blind selector guess given how fragile these hiders have been (see
      `memory/issues-fixed.md` #18).
- [ ] **New-session-overview hider** (`hideNewSessionOverview()` in banners.js) — still disabled
      since the /epitaxy blank-page bug (#18). Not reconfirmed either way; rework or confirm safe
      to delete like the top-bar hider was.
- [ ] Audit `hideUnavailableBanners` for the same whole-container risk that hit the top-bar and
      overview hiders.
- [ ] **KDE titlebar no longer hidden** — `StartupWMClass` mismatch in
      `claude-desktop.desktop` (`claude-desktop` vs the actual `--class=Claude`) is fixed. Likely
      also affected: the GPU-crash fix (#17) added `CLAUDE_USE_WAYLAND=1`, which switched the app
      from an XWayland client to a native-Wayland one — KWin matches native Wayland windows by
      `app_id`, not X11 `WM_CLASS`, so any old window rule keyed on the X11 class silently stopped
      matching. No `~/.config/kwinrulesrc` rule exists on this system at all, so if one was never
      saved, a manual "no titlebar" toggle wouldn't survive the recent restarts either way. Fix:
      open System Settings → Window Management → Window Rules → Add, focus Claude Desktop, click
      "Detect Window Properties" (captures whatever KWin actually matches on right now), and set
      "No titlebar and frame" → Force → Yes.
- [ ] Verify whether Ctrl+1/2/3 is now natively bound — our handler runs capture-phase and
      `stopPropagation()`s, so it always masks a native equivalent and this can't be confirmed
      from code alone. To test: comment out the block in `topbar.js`, re-patch, and check if
      Ctrl+1/2/3 still switches Chat/Cowork/Code without it.
- [ ] Consider re-patching against a current app version (official is 2.1.201 under
      `~/.local/share/claude/versions/`; patched build is still 2.1.149).

- [ ] Usage counter doesn't refresh until clicked; Ctrl+Shift+R does nothing (and Ctrl+` doesn't
      open the terminal); the effort selector disappears too quickly. Reported 2026-06-26,
      moved here 2026-07-27 from the Timekeeper project where it had been misfiled.

---

## Not Planned ❌
- Weekly usage circle — data not reliably in the DOM (floating bar shows W% instead).
- Workspace "New Project on SSH" — needs main-process IPC to create remote dirs.

---

For architecture, decisions, and bug history, see [`memory/`](memory/MEMORY.md).

## How to test
1. Edit the module in `custom-ui/` · 2. `./scripts/update-ui.sh` · 3. `~/.local/bin/claude-quit`
· 4. Relaunch from the app menu · 5. Check console for `[custom-ui] ok`.
