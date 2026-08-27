---
name: todo-writing-style
description: "TODO items and chat replies should lead with the action; detail belongs to whoever executes, and verification is a standing section split by who checks"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 150bf9d3-9886-4ebc-a8e0-5a71ae5fd07e
  modified: 2026-08-27T12:28:16.289Z
---

Write to the reader who will act on the line. An item for the user is one sentence naming what
they should see or decide, with no mechanism, root cause, or file paths; a link covers the rest.
An item for the agent may carry the detail, because the agent ingests it and runs the check.
Same in chat: give the action, and let the reasoning be asked for.

**Why:** said directly 2026-08-27 while rewriting two TODO items down to a line each, then
generalized: "sometimes I don't need the detail, I just need the action." The long form was not
wrong, it was addressed to nobody in particular. Losing the detail costs nothing because it
already lives in `issues-fixed.md` and the changelog, where it is looked up when something breaks.

**How to apply:** `## 🔍 Verification` is a standing section with `### Mine` / `### Yours`
subheads, for things that should keep being true rather than tasks to close; check the Mine ones
without being asked. Fix a convention breach in the session that finds it instead of filing it.
A checked `- [x]` never stays in a TODO file, which is now enforced by
`~/.claude/hooks/check-todo-done-items.py` rather than by remembering. Full rules in the
workspace's `memory/conventions.md`.
