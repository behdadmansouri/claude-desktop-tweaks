# TODO - Claude Desktop 🤖

Feature status lives in [memory/features.md](memory/features.md), bug history in
[memory/issues-fixed.md](memory/issues-fixed.md), the edit/deploy loop in
[CLAUDE.md](CLAUDE.md#quick-start). This file is open work only.

## ⚡ Next up

- [ ] **The patched build has no update path** `L` `think` - `claude-desktop-appimage` was
      removed from the AUR (2026-08-14), so `scripts/update-appimage.sh` fails at step 1. The
      installed build is 1.24012.9; Anthropic's official app is already 1.26832.0 and AUR
      `claude-desktop-extra` is 1.30096.1. Pick a new base and rework the script:
      [memory/maintenance.md](memory/maintenance.md) has the option comparison.

- [ ] **Duplicate "close right bar" buttons in Cowork** `M` - two floating close buttons appear
      at once. Needs live DOM inspection (devtools or a screenshot) before any fix; no blind
      selector guess, given how fragile the hiders have been ([issues-fixed.md](memory/issues-fixed.md) #18).

## 🤔 Needs your call

- [ ] **KDE titlebar no longer hidden** `S` - a manual System Settings step, not a code change.
      Window Management → Window Rules → Add → focus Claude Desktop → "Detect Window Properties"
      → set "No titlebar and frame" → Force → Yes. Why it broke: the GPU-crash fix (#17) added
      `CLAUDE_USE_WAYLAND=1`, turning the app from an XWayland client into a native-Wayland one.
      KWin matches native Wayland windows by `app_id`, not X11 `WM_CLASS`, so any rule keyed on
      the old class silently stopped matching. No `~/.config/kwinrulesrc` exists on this system
      at all, so a rule likely was never saved in the first place.

- [ ] **Effort selector disappears too quickly** `S` - native app behavior, not ours. Decide
      whether it's worth a custom-ui hover-persistence patch or just lived with. Reported
      2026-06-26.

## 📋 Backlog

- [ ] **Bring `titlewatch.js` to the official app, or don't** `M` - the official build has no
      custom UI, so its window title stays `"Claude"` and Timekeeper's ActivityWatch watcher
      learns nothing from it. Only matters if the official app becomes the daily driver.

## ❌ Not planned

- **Workspace "New Project on SSH"** - needs main-process IPC to create remote directories.
