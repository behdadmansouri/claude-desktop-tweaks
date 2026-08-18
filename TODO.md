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

- [ ] **Usage chip shows `ctx --`** `M` - the 5-hour and weekly numbers are live off
      `/api/organizations/<org>/usage`, but the context window has no endpoint and is only in the
      usage popover's DOM, so it reads as unknown most of the time. Next step: run with
      `localStorage['cc-usage-probe']='1'` and watch `[cc-usage-probe]` in the console for an API
      payload that carries a token count. Do **not** re-add a timer that opens the popover
      ([issues-fixed.md](memory/issues-fixed.md) #13).

- [ ] **Duplicate "close right bar" buttons in Cowork** `M` - two floating close buttons appear
      at once. Needs live DOM inspection (devtools or a screenshot) before any fix; no blind
      selector guess, given how fragile the hiders have been ([issues-fixed.md](memory/issues-fixed.md) #18).

- [ ] **Full-width chat column** `S` - the transcript is capped to a readable measure; user wants
      it to use the whole window. Blocked on knowing *what* caps it: read `widthChain` out of the
      next `[cc-dump]` line (see [debugging.md](memory/debugging.md)) and write a CSS override
      against the computed `max-width`, not against a guessed Tailwind class.

## 🤔 Needs your call

- [ ] **Remove the top bar** `M` `think` - user wants the row gone (back/forward unused, magnifier
      has a shortcut, sidebar toggle unused) to reclaim vertical space. The catch: that row *is*
      the window's titlebar. It carries the drag region and the minimise/maximise/close controls,
      so removing it outright leaves no way to move or close the window with the mouse. Three
      options: hide only the left button cluster (keeps the bar's height, reclaims nothing); shrink
      the bar; or remove it and re-enable the KDE titlebar instead (the "KDE titlebar no longer
      hidden" item below is the same knob). Also note #18: a blanket attribute-selector hider on
      this row blanked the whole app once already.

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
