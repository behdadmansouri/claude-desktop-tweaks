---
name: always-push
description: "Finish work by pushing, not just committing; an unpushed branch surfaces as a \"Create PR\" prompt and reads as unfinished"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 150bf9d3-9886-4ebc-a8e0-5a71ae5fd07e
  modified: 2026-08-27T13:08:17.285Z
---

Push in the same session the work is finished. Committing as you build is not the whole rule.

**Why:** said 2026-08-27 ("Always push!") after the Claude Desktop app showed a Create PR button,
which appears when a branch sits ahead of its remote. The tree was clean and every change was
committed; 31 commits had simply never been pushed, because pushing had been treated as a separate
thing to ask about. To the user that button reads as unfinished work.

**How to apply:** push when the work is done, without asking. Ask first only when the repo is
public and the change is genuinely sensitive. Related: [[todo-writing-style]].
