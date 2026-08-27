# TODO - Claude Desktop 🤖

Open work only. Shipped history: [memory/changelog.md](memory/changelog.md). Bugs:
[memory/issues-fixed.md](memory/issues-fixed.md). How to run any of it: [USAGE.md](USAGE.md).

## ⚡ Next up

- [ ] **The patched build has no update path** `L` `think` - `claude-desktop-appimage` left the
      AUR 2026-08-14, so `update-appimage.sh` dies at step 1. Pick a new base:
      [memory/maintenance.md](memory/maintenance.md) compares the options. 🤖

- [ ] **Rewrite the `update-claude-desktop` skill** `S` - it drives the dead script and knows
      nothing of `claude-ctl`. Do it with the base decision above. 🤖

- [ ] **Make a failed `--official` re-patch loud** `S` - `claude-ctl update` swallows the error
      and the build silently runs unpatched. Notify through Hermes (preferred) or the dashboard. 🤖

## 🔍 Verification

Not one-off checks; standing monitors. Something here graduates to the changelog only once it
has held up over a few days.

### Mine

- [ ] **Window title keeps naming the project** - `Project 🤖 · Conversation` in the
      ActivityWatch window bucket. Project half confirmed 2026-08-27; conversation half was
      reading `Code` and now comes from the session record, unconfirmed. 🤖

- [ ] **The official build stays in sync after its own updates** - `install-official.sh`
      replaces the whole prefix, so re-patch after every update. `claude-ctl` reports it. 🤖

### Yours

- [ ] **Context shows without clicking usage** - the chip should carry a context ring on its
      own. Percentage needs the popover opened once, ever, to learn the window size.
      ([issues-fixed.md](memory/issues-fixed.md) #13)

- [ ] **The 5 repo-named projects keep their emoji** - `connoisseurd 🎨` and friends, after the
      app updates.

## 🤔 Needs your call

(nothing waiting on you right now)

## 📋 Backlog

- [ ] **Reclaim the empty `.epitaxy-titlebar` strip** `S` - 32px of dead drag region right of
      the tab pills. The band above them is already gone.

## Draft

(empty)
