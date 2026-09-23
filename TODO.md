# TODO - Claude Desktop 🤖

Open work only. 🤖 = I do it, 🧍 = you do it. Shipped history:
[memory/changelog.md](memory/changelog.md). Bugs: [memory/issues-fixed.md](memory/issues-fixed.md).
How to run things: [USAGE.md](USAGE.md). Trimmed detail: [memory/todo-archive.md](memory/todo-archive.md).

## ⚡ Next up

- [ ] 🤖 **Release the project switcher as open source** `L` `think` - plan and phases in
      [docs/open-source-release.md](docs/open-source-release.md); marketing is a later session.

- [ ] 🤖 **Find a new base for the patched build** `L` `think` - its AUR package is gone, so it
      can no longer update at all. [memory/maintenance.md](memory/maintenance.md) compares the
      options.

- [ ] 🤖 **Rewrite the `update-claude-desktop` skill** `S` - it drives a dead script. Do it with
      the decision above.

## 🔍 Verification

Standing checks, not tasks. They move to the changelog once they have held up for a few days.

- [ ] 🧍 **After a restart, the panel shows lanes, an Inbox button and scanned remote projects** -
      Myserver, MyHostinger and Dad should list their `~/AI Projects` folders under Remote; a host
      that says "could not scan" names its ssh error.

- [ ] 🧍 **The project panel shows on a new session** - it sits beside the composer on the
      page where you pick a folder. Missing again means the `epitaxy-env-pill` test id moved.

- [ ] 🧍 **The usage chip shows a context number on its own** - you should never have to click
      the usage button to see it. A count with no percentage is expected until you have opened
      the usage popover once; that is where the chip learns how big the context window is.

- [ ] 🤖 **ActivityWatch records project and conversation** - the window title should read
      `Project 🤖 · Conversation name`. Check the window bucket; the project half is confirmed,
      the conversation half is not.

- [ ] 🤖 **The official build is still patched after it updates** - its installer replaces the
      whole prefix, and now re-patches itself; `claude-ctl` reports all four main-process patches
      per build. Unverified until the 1.40609.1 update actually runs.
