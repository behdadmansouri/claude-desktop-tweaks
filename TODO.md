# TODO - Claude Desktop 🤖

Feature status lives in [memory/features.md](memory/features.md), bug history in
[memory/issues-fixed.md](memory/issues-fixed.md), the edit/deploy loop in
[CLAUDE.md](CLAUDE.md#quick-start). This file is open work only.

## ⚡ Next up

- [x] **Merge the stranded untrack commit before any push** - done 2026-08-26. Cherry-picked as
      `e219450` (one `.gitignore` conflict, both hunks kept), worktree removed, branch
      `claude/blissful-noether-bd840c` deleted. `index.js` / `index.chunk-*.js` are untracked
      *and* gone from the working tree - re-extract from the asar if one is ever needed again.
      The push itself is still unmade and still the user's call.

- [x] **Commit the in-flight #46 work** - done 2026-08-26 as part of `244925f`; tree is clean.

- [ ] **Rewrite the `update-claude-desktop` skill** `S` - `~/.claude/skills/update-claude-desktop/SKILL.md`
      (frozen 2026-07-24) still drives `update-appimage.sh`, dead since the AUR removal, and
      knows nothing of `claude-ctl`, `--official`, or the autoupdate timer. A cold agent
      following it fails at step 1. Rewrite after (or alongside) the base decision below. 🤖

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

- [ ] **Kill the dead band above the tab pills** `S` - **fixed and deployed 2026-08-26, unseen.**
      `topChain` came back with `anchor:null` (the pill text match failed), so the answer came
      from the app's own stylesheet instead: `.dframe-root[data-wco]{--df-chrome-bar-height:36px}`,
      consumed only by `.dframe-content{padding-top}` and `.dframe-sidebar{top:calc(8px + …)}` -
      the same two paddings the user had already removed by hand. `css.js` now zeroes that
      variable; `localStorage['cc-chrome-bar']='keep'` puts it back. After a restart the pills
      should sit ~36px higher with the sidebar, and nothing should be clipped at the top of the
      page. The empty `.epitaxy-titlebar` strip to their right is a separate 32px item, still open.

- [ ] **Sidebar rows lost their project emoji** `M` - reported 2026-08-26: rows read
      `connoisseurd`, `dogether`, `claude-desktop-tweaks` where the folders on disk are
      `Connoisseurd 🎨`, `Dogether 🐕`, `Claude Desktop 🤖`. Those labels are not the folder
      basenames (`claude-desktop-tweaks` is the *repo* name), so the app is naming the row from
      something other than the path, and `splitEmoji()` - verified against the real folder list,
      32/32 correct - is not involved. `diag.js` now dumps `sidebarRows` (visible text, the
      `.df-leading-slot` contents/width, and every `data-*`/`title`/`href` on the row). Open the
      sidebar, run `window.__ccDump()`, and read the line before writing any fix.

- [ ] **Verify the usage chip lands in the composer footer** `S` - the mis-attach is fixed and
      deployed ([issues-fixed.md](memory/issues-fixed.md) #46) but unseen: it was matching a
      session row's "More options for ... and pla**nning**" button. After a restart the chip
      should sit inline next to Opus 5 / Medium with the app's own ring collapsed, and no session
      row should have text painted over it. `window.__ccUsage().attachedTo` names the match.

- [ ] **Verify the open-TODO badge is readable** `S` - fixed and deployed 2026-08-26 (the digit
      was inheriting the same colour as its own ground; see the commit and
      [issues-fixed.md](memory/issues-fixed.md) #47). After a restart the tile dot should be
      terracotta with a cream number in light mode and amber with a dark number in dark mode, and
      the named-mode pill's number should be full strength at every count.

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

- [ ] **KDE titlebar no longer hidden** `S` - a manual System Settings step, not a code change.
      Window Management → Window Rules → Add → focus Claude Desktop → "Detect Window Properties"
      → set "No titlebar and frame" → Force → Yes. Why it broke: the GPU-crash fix (#17) added
      `CLAUDE_USE_WAYLAND=1`, turning the app from an XWayland client into a native-Wayland one.
      KWin matches native Wayland windows by `app_id`, not X11 `WM_CLASS`, so any rule keyed on
      the old class silently stopped matching. No `~/.config/kwinrulesrc` exists on this system
      at all, so a rule likely was never saved in the first place.

## 📋 Backlog

- [ ] **Make a failed `--official` re-patch loud** `S` - `claude-ctl update` runs
      `update-ui.sh --official || true`, so when the timer installs a new official build and the
      patch RuntimeErrors (the eipc marker is already known missing there), the build silently
      runs unpatched. Surface the failure: nonzero exit, a line in the check-updates status, or a
      desktop notification. 🤖

- [ ] **Rename `CLAUDE.md` to `AGENTS.md`** `S` - codex compliance ("reverse any you find").
      Needs a grep pass, not just `git mv`: the skill, `memory/*.md`, and scripts reference the
      name. 🤖

- [ ] **Memory hygiene pass** `S` - `project_claude_desktop_gpu_crash.md` still prescribes
      `CLAUDE_DISABLE_GPU=1`, which maintenance.md says was removed; `MEMORY.md` says issues
      "#1-40" vs actual #47; no `USAGE.md` despite `claude-ctl`/timer being operable tooling.
      Done 2026-08-26: `memory/changelog.md` created, CLAUDE.md registry corrected, flat-memory
      exception documented. 🤖

- [x] **Bring `titlewatch.js` to the official app, or don't** `M` - done 2026-08-25, and the whole
      custom UI came with it rather than titlewatch alone. `update-ui.sh --official` patches
      `~/.local/lib/claude-desktop-official`; everything is located by content signature, so no
      version pinning was needed. Caveat: `install-official.sh` replaces the whole prefix, so
      re-run the patch after every official update. Not yet applied - there is a pending update
      (1.26832.0 → 1.34493.1), so install that first.
      **Confirmed still live 2026-08-26, cross-project** (Time Management project, from
      ActivityWatch's own window-title data): the running app's window still reports app id
      `Claude`, title `Code` (plus a Nerd Font glyph) for ~95 of the last 600 minutes - a generic,
      non-enriched title, exactly the symptom this item exists to fix. Not new information, just a
      live data point that the fix genuinely hasn't reached the running app yet.

- [ ] **Decide whether the official build should share the session index** `S` - the script exists
      (`scripts/share-sessions.sh`, `--undo` to reverse) but has not been run. It symlinks only
      `claude-code-sessions/`; transcripts under `~/.claude/projects/` are already shared and
      claude.ai chats are server-side, so that link is the entire difference. Never run both
      builds at once against it.

## Draft
(empty - both items processed 2026-08-26: the emoji tiles now carry the number itself, and the
"New Project on SSH" is marked not-planned in [features.md](memory/features.md))
