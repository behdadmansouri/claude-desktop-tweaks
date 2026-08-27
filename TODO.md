# TODO - Claude Desktop 🤖

Feature status lives in [memory/features.md](memory/features.md), bug history in
[memory/issues-fixed.md](memory/issues-fixed.md), the edit/deploy loop in
[CLAUDE.md](CLAUDE.md#quick-start). This file is open work only.

## ⚡ Next up

- [ ] **Rewrite the `update-claude-desktop` skill** `S` - `~/.claude/skills/update-claude-desktop/SKILL.md`
      (frozen 2026-07-24) still drives `update-appimage.sh`, dead since the AUR removal, and
      knows nothing of `claude-ctl`, `--official`, or the autoupdate timer. A cold agent
      following it fails at step 1. Rewrite after (or alongside) the base decision below. 🤖

- [ ] **The patched build has no update path** `L` `think` - `claude-desktop-appimage` was
      removed from the AUR (2026-08-14), so `scripts/update-appimage.sh` fails at step 1. The
      installed build is 1.24012.9; Anthropic's official app is already 1.26832.0 and AUR
      `claude-desktop-extra` is 1.30096.1. Pick a new base and rework the script:
      [memory/maintenance.md](memory/maintenance.md) has the option comparison.

- [ ] **Verify the context figure without clicking usage** `M` - **built and deployed 2026-08-27,
      unseen.** Reported twice: the number only appears after opening the usage popover, because
      the app fills its own tray label when that popover renders and lets it go stale otherwise
      (three dumps, three labels: `Usage: plan 3%`, `context 0`, and the real 13% only while it
      was open). Scraping harder cannot fix that, so the number is now *computed*: the Code tab
      is Claude Code, so the open session has a real transcript, and `cc-session-info` reads the
      last assistant entry's `usage` object out of it. Verified offline against this very
      session before deploying (207,981 tokens, transcript resolved via the folder slug).
      The **denominator is learned, never guessed** - the transcript records no limit and it
      moves with the model, so the window size is remembered from the app's own popover the
      first time it is seen (`cc-usage-ctx-total`). Until then the hover card shows `208k used`
      with no percentage and the chip drops the ring, which is the honest reading; open the
      popover once and the percentage works from then on. Do **not** re-add a timer that opens
      the popover ([issues-fixed.md](memory/issues-fixed.md) #13).

- [ ] **Verify the window title names the project** `M` - **built and deployed 2026-08-27,
      unseen.** Reported: ActivityWatch can tell Chat from Code from Cowork and nothing else, so
      the data cannot answer "how long did I spend on Dogether". Same root cause as the item
      above - the renderer only knows the route - and the same fix: `cc-session-info` returns the
      session's `cwd`, and `titlewatch.js` puts the folder name first, as
      `Claude Desktop 🤖 · Sidebar emoji fix`. Project first because every taskbar clips a title
      from the right. Check with `window.__ccTitleDebug()` (it now reports `project` and the
      whole session record), and confirm in ActivityWatch that the window bucket carries the
      folder name rather than `Code`.

- [ ] **Verify the usage chip lands in the composer footer** `S` - the mis-attach is fixed and
      deployed ([issues-fixed.md](memory/issues-fixed.md) #46) but unseen: it was matching a
      session row's "More options for ... and pla**nning**" button. After a restart the chip
      should sit inline next to Opus 5 / Medium with the app's own ring collapsed, and no session
      row should have text painted over it. `window.__ccUsage().attachedTo` names the match.

- [ ] **Catch the "Capturing" inhibitor in the act** `S` - it is **not** permanent. A live check
      (`claude-ctl` prints the list) found only the Electron `powerSaveBlocker` and Chromium
      "Playing audio" - no Capturing entry. So it is a Chromium **media-capture** inhibitor tied
      to an open mic/camera/screen-capture stream, most likely dictation, and it releases when the
      stream does. Next time it shows up, run `claude-ctl` and note what else is holding one.
      Nothing to fix unless it is still held with no capture running. Partial confirmation
      2026-08-26: the renderer log carries `ScriptProcessorNode is deprecated` at 00:31 and
      00:33, i.e. an audio-capture graph was live at exactly the moment the panel showed a
      second inhibitor. That is dictation. Still want one sighting where `claude-ctl` and the
      log are read together.

## 🤔 Needs your call

(nothing waiting on you right now)

## 📋 Backlog

- [ ] **Make a failed `--official` re-patch loud** `S` - `claude-ctl update` runs
      `update-ui.sh --official || true`, so when the timer installs a new official build and the
      patch RuntimeErrors (the eipc marker is already known missing there), the build silently
      runs unpatched. Surface the failure: nonzero exit, a line in the check-updates status, or a
      desktop notification. 🤖

- [ ] **Rename `CLAUDE.md` to `AGENTS.md`** `S` - codex compliance ("reverse any you find").
      Needs a grep pass, not just `git mv`: the skill, `memory/*.md`, and scripts reference the
      name. 🤖

- [ ] **A `USAGE.md` for the operable tooling** `S` - `claude-ctl`, the autoupdate timer and
      `share-sessions.sh` are things you *run*, and their documentation is spread across
      CLAUDE.md's registry and `maintenance.md`. The rest of the hygiene pass is finished: the
      changelog exists, the registry is correct, the issue counts match, and
      `project_claude_desktop_gpu_crash.md` no longer prescribes the `CLAUDE_DISABLE_GPU=1` step
      that the v3.0.0 launcher made unnecessary (corrected 2026-08-27). 🤖

- [ ] **Decide whether the official build should share the session index** `S` - the script exists
      (`scripts/share-sessions.sh`, `--undo` to reverse) but has not been run. It symlinks only
      `claude-code-sessions/`; transcripts under `~/.claude/projects/` are already shared and
      claude.ai chats are server-side, so that link is the entire difference. Never run both
      builds at once against it.

## Draft
(empty - both items processed 2026-08-26: the emoji tiles now carry the number itself, and the
"New Project on SSH" is marked not-planned in [features.md](memory/features.md))
