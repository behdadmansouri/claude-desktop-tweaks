# TODO archive - Claude Desktop 🤖

Detail trimmed out of [TODO.md](../TODO.md) when items were shortened. Not a changelog (that is
[changelog.md](changelog.md)) and not a bug record ([issues-fixed.md](issues-fixed.md)) - just the
context a line used to carry, kept in case a short item ever needs unpacking. Nothing here needs
reading unless an item goes wrong.

## 2026-08-27

**Context figure without the popover.** The app fills its own tray label only while the usage
popover renders, then lets it go stale - three dumps showed `Usage: plan 3%`, `context 0`, and the
real 13% only while it was open. So the number is computed from the session transcript instead
(`cc-session-info`, last assistant entry's `usage` object). The window *size* is not in the
transcript and moves with the model, so it is learned from the app's own popover once and cached
in `cc-usage-ctx-total`; until that happens the card shows a token count with no percentage rather
than a guessed fraction. Do not re-add a timer that opens the popover (issues-fixed #13).

**Window title.** `cc-session-info` returns the session's `cwd`; `titlewatch.js` puts the folder
name first because taskbars clip from the right, and takes the conversation name from the session
record rather than the DOM (the DOM strategies were finding the tab pill, which is why the bucket
read `Claude Desktop 🤖 · Code`). Debug with `window.__ccTitleDebug()`.

**Failed `--official` re-patch.** `claude-ctl update` runs `update-ui.sh --official || true`, so a
RuntimeError there is swallowed; the eipc marker is already known missing on that build.

**The empty `.epitaxy-titlebar` strip.** 32px of dead drag region right of the tab pills, left
alone 2026-08-27 - the band above the pills was the part that mattered and it is gone.

**The "Capturing" inhibitor.** Dropped as an item: it is a Chromium media-capture inhibitor tied
to an open mic stream (dictation), it releases with the stream, and it stopped being a nuisance.
`claude-ctl` lists every inhibitor if it ever comes back.
