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
- **Repo hygiene:** the stranded untrack commit is on `main` (`e219450`), the stale agent worktree
  and its branch are gone, and 18.6 MB of extracted Anthropic bundles are out of the tree. Still
  unpushed.

Confirmed fixed by the user in the same pass, no code of ours involved: the chat column is
full-width, Cowork no longer shows duplicate close buttons, and the effort selector stays put.

## Before 2026-08-26

Not reconstructed. See `git log`, [features.md](features.md) and [issues-fixed.md](issues-fixed.md)
(#1-45), which were the record until this file existed.
