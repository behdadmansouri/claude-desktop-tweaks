---
name: project_claude_desktop_symlink_gotcha
description: "Claude Desktop: ~/.config/Claude/custom-ui.js symlink breaks silently when the project folder is renamed, making update-ui.sh deploy stale code"
metadata:
  type: project
---

In the Claude Desktop project, `scripts/update-ui.sh` reads the source from `~/.config/Claude/custom-ui.js`, which is a **symlink** into the project folder (`~/Documents/AI Projects/Claude Desktop 🤖/custom-ui.js`).

When the project folder is renamed (e.g. adding the 🤖 emoji), the symlink keeps pointing at the OLD path and breaks silently. `update-ui.sh` then reads a dead path / stale copy, so deployed UI features appear "broken" or reverted even though the project file is correct.

**Why:** discovered 2026-06-19 — many features looked stale/regressed purely because the symlink had been dangling since the folder was renamed.

**How to apply:** if custom-ui.js changes don't take effect after `update-ui.sh` + restart, FIRST check `ls -la ~/.config/Claude/custom-ui.js` resolves to the real file. Fix with `ln -sfn "<real path>" ~/.config/Claude/custom-ui.js`. Re-point it after any folder rename.
