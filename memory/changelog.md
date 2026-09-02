# Changelog - Claude Desktop 🤖

Feature-level, dated, append-only. Not a per-commit log (`git log` covers that) and not a session
log. Bug *post-mortems* live in [issues-fixed.md](issues-fixed.md); this is the "what shipped,
in what order" view.

## 2026-09-01

- **The official Claude Desktop build now carries the custom UI.** It has gone from a side-by-side
  curiosity to the daily driver, so everything the patched build has - project panel, usage chip,
  window title, one-click folder open, folder-picker default, native window frame, work-aware
  keep-awake - now applies to it as well.
- **The patcher no longer assumes one main-process chunk, or one quote character.** Each site is
  located by content across every chunk and matched against either `"` or a template literal; only
  the chunks that changed are rewritten, and each is syntax-checked. Post-mortem: [#51](issues-fixed.md).
  This also repaired the one-click folder open on the daily build, whose signature turned out never
  to have matched anything.
- **An official update can no longer silently drop the patch.** `install-official.sh` replaces the
  whole prefix, so it now re-applies the custom UI itself and fails loudly (with a desktop
  notification) instead of leaving a normal-looking but unpatched app. `--no-patch` opts out.
- **`claude-ctl` and the session-start update check report both builds**, including which of the
  four main-process patches are applied to each, so a release that moves a site shows up as one
  "not applied" cell rather than as a feature quietly going missing.

## 2026-08-27

- **`CLAUDE.md` is now `AGENTS.md`** - the workspace convention since 2026-08-18; this project had
  carried the old name since it was created (2026-06-19) and had it sitting in a backlog after a
  review spotted it. References updated everywhere but `docs/review-2026-08.md`, which is a dated
  document quoting the state at the time.
- **`USAGE.md`** - the operator's page for `claude-ctl`, the timer, the patch loop and session
  sharing, which had been spread across the registry and `maintenance.md`.
- **The official build now shares the session list** (`claude-ctl share`), 366 records. Only the
  index is linked; transcripts were always shared.
- **The window title carries the conversation, not the tab.** Measured in the ActivityWatch bucket:
  327 minutes of `Code`, then `Claude Desktop 🤖 · Code` once the project half landed - the DOM
  strategies were finding the tab pill. The session record's own title is used now.
- **`TODO.md` gained a `Verification` section split into Mine and Yours**, and lost its wordiness.
  Both are now workspace-wide conventions.
- A Stop hook (`~/.claude/hooks/check-todo-done-items.py`, this laptop) blocks on any `- [x]` left
  in a TODO file, so the "finished items live in the changelog" rule stops depending on memory.

## 2026-08-26

- **Usage chip stops hijacking session rows.** It was attaching itself to the ⋯ button of a chat
  whose title contained "planning", because the match was a substring test on `plan`. Now a
  word-boundary match, scored across candidates, and never a control inside a list row
  (issues-fixed #46).
- **Emoji tiles in the project selector carry the open-TODO number**, not just a dot. Short and
  full modes were already showing it.
- **`claude-ctl` tells the truth about sleep.** It read our own `[cc-keep-awake]` lines, which
  never reach `main.log`, and so reported the governor as inactive while it was running. It now
  reads the app's own start/stop lines and prints *why* sleep is held: the age of the newest
  session file against the idle window (issues-fixed #47).
- **`diag.js` dumps `topChain`** - ancestor padding/height above the tab pills, plus
  `elementFromPoint` inside the empty band - so the dead top band can be collapsed by measurement
  rather than by a guessed selector.
- **The open-TODO badge is legible in both themes.** It was painting its number in a colour it
  borrowed from outside the panel, which in one theme matched its own ground exactly, and fading
  the number along with the tint at low counts (issues-fixed #48).
- **The dead 36px band above the tab pills is gone.** It was `--df-chrome-bar-height`, set only
  under `[data-wco]` - the app reserving room for window controls it no longer draws, now that
  KWin owns the frame. `cc-chrome-bar=keep` restores it (issues-fixed #49).
- **`diag.js` dumps `sidebarRows`** - row text, leading-slot contents and width, and every
  `data-*` on the row - to answer why sidebar rows show `claude-desktop-tweaks` rather than the
  folder name `Claude Desktop 🤖`.
- **Sidebar project groups get their emoji back.** The five folders with a GitHub remote are
  named by the app after `owner/repo`, not after the folder, which is why only those lost the
  glyph. `custom-ui/labels.js` appends it, from a remote-to-folder map baked out of each
  `.git/config` (issues-fixed #50).
- **`diag.js` gains `findLabels`** - searches the document for text known to be on screen and
  dumps a slice of its row's markup. Two container-scoped probes had come back with chat titles.
- **The window title names the project.** ActivityWatch could only ever see `Code` / `Chat` /
  `Cowork`, so a week of window-title data could not say which project the time went to. The
  caption now reads `Claude Desktop 🤖 · Sidebar emoji fix`, project first.
- **The context figure no longer needs the usage popover open.** It is computed from the
  session's own transcript instead of scraped: the Code tab is Claude Code, so the last
  assistant entry's `usage` object is the same arithmetic the CLI shows. The window *size* is
  still learned from the app rather than assumed, so the percentage appears once the popover has
  been opened once, and until then the card shows a token count with no percentage.
- Both of the above come from one new main-process handler, `cc-session-info`, which reads the
  app's own per-session record (cwd, cliSessionId, title, model) and the transcript tail.
- **Repo hygiene:** the stranded untrack commit is on `main` (`e219450`), the stale agent worktree
  and its branch are gone, and 18.6 MB of extracted Anthropic bundles are out of the tree. Still
  unpushed. `TODO.md` is open work only again; six finished items were folded into this file, and
  the KDE-titlebar question is closed (the frame is wanted now).

Confirmed fixed by the user in the same pass, no code of ours involved: the chat column is
full-width, Cowork no longer shows duplicate close buttons, and the effort selector stays put.

## Before 2026-08-26

Not reconstructed. See `git log`, [features.md](features.md) and [issues-fixed.md](issues-fixed.md)
(#1-45), which were the record until this file existed.
