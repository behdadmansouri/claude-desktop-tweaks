# TODO - Claude Desktop 🤖

Open work only. 🤖 = I do it, 🧍 = you do it. Shipped history:
[memory/changelog.md](memory/changelog.md). Bugs: [memory/issues-fixed.md](memory/issues-fixed.md).
How to run things: [USAGE.md](USAGE.md). Trimmed detail: [memory/todo-archive.md](memory/todo-archive.md).

## ⚡ Next up

- [ ] 🤖 **Release the project switcher as open source** `L` - moved to
      `../Claude Project Switcher 🗂️/` (plan in its `docs/plan.md`); this folder stays the private source.

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
      whole prefix, and now re-patches itself; `check-updates.sh` reports whether the deployed patch
      is missing or stale. Unverified until the next official update actually runs.
