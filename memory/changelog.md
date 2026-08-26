# Changelog - Claude Desktop 🤖

Feature-level, dated, append-only. Not a per-commit log (`git log` covers that) and not a session
log. Bug *post-mortems* live in [issues-fixed.md](issues-fixed.md); this is the "what shipped,
in what order" view.

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

Confirmed fixed by the user in the same pass, no code of ours involved: the chat column is
full-width, Cowork no longer shows duplicate close buttons, and the effort selector stays put.

## Before 2026-08-26

Not reconstructed. See `git log`, [features.md](features.md) and [issues-fixed.md](issues-fixed.md)
(#1-45), which were the record until this file existed.
