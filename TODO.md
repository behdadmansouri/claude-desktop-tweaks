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

- [ ] **Trace the second sleep inhibitor** `M` - KDE shows two, and only one is ours to fix. The
      Electron one is handled ([issues-fixed.md](memory/issues-fixed.md) #43); the other reads
      "Claude Desktop is blocking screen locking. (Capturing)" and is a Chromium *capture*
      inhibitor, not `powerSaveBlocker`. Owner unknown - likely a getUserMedia/getDisplayMedia
      grab that is never released, possibly the Cowork VM. Start by checking whether it persists
      with the Cowork VM stopped.

- [ ] **Verify the keep-awake governor over a real idle night** `S` - grep `[cc-keep-awake]` in
      `~/.config/Claude/logs/main.log`. Expect `working` while sessions run and `idle` within ~30
      min of stopping, plus a matching `[keep-awake] stopped`. If it flips to `idle` mid-run,
      raise the window: `CC_KEEPAWAKE_IDLE_MIN=60`.

## 🤔 Needs your call

- [ ] **Confirm the top bar hider picked the right element** `S` - decided and shipped
      2026-08-18 (`custom-ui/chrome.js`), but the match was never seen against the live DOM. After
      a restart check `[cc-chrome]` in the renderer log: "top bar hidden (Npx reclaimed)" is good,
      "hide reverted" means the geometry match needs tightening against the `[cc-dump]` topBar
      array. Window drag/close now depend on the KDE titlebar and Ctrl+Q.

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

- [x] **Bring `titlewatch.js` to the official app, or don't** `M` - done 2026-08-25, and the whole
      custom UI came with it rather than titlewatch alone. `update-ui.sh --official` patches
      `~/.local/lib/claude-desktop-official`; everything is located by content signature, so no
      version pinning was needed. Caveat: `install-official.sh` replaces the whole prefix, so
      re-run the patch after every official update. Not yet applied - there is a pending update
      (1.26832.0 → 1.34493.1), so install that first.

- [ ] **Decide whether the official build should share the session index** `S` - the script exists
      (`scripts/share-sessions.sh`, `--undo` to reverse) but has not been run. It symlinks only
      `claude-code-sessions/`; transcripts under `~/.claude/projects/` are already shared and
      claude.ai chats are server-side, so that link is the entire difference. Never run both
      builds at once against it.

## Draft
Not planned: workspace "New Project on SSH" - needs main-process IPC to create remote
directories, not currently worth the scope.
