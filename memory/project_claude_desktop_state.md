---
name: claude-desktop-patching-state
description: "Current state of the Claude Desktop patching project — what works, what broke, how to continue"
metadata: 
  node_type: memory
  type: project
  originSessionId: 32571da7-297f-43a2-94ef-bd1b5e9e2ddb
---

Claude Desktop is patched and working as of 2026-07-08. Wiki lives at `memory/` (split into multiple files, indexed by `memory/MEMORY.md`).

**Why:** User wants custom UI injected into Claude Desktop's Electron renderer via a patched asar.

**How to apply:** Start from `CLAUDE.md` for file registry, then open the relevant `custom-ui/` module.

Key facts:
- Patched app is at `/home/z3z0/.local/lib/claude-desktop-patched/`, asar version 2.1.149 (official app has auto-updated ahead to 2.1.201 under `~/.local/share/claude/versions/` — patched build has not been rebased onto it yet)
- `custom-ui.js` is v15, built from modules in `custom-ui/` by `scripts/update-ui.sh`
- `update-ui.sh` embeds the combined JS into `mainView.js` inside the asar
- Top-bar hider and its DOM scanner (`findTopBar`/`hideTopBar`) were removed entirely in v15 — the native in-app top bar now renders correctly on its own; see [[issues-fixed]] #18
- Sidebar DOM (dframe): chat rows are `<div data-row>` + `<button data-row-main-button>`; no chat ID in DOM; key on chat title from "More options" aria-label; active chat has `data-selected`
- MutationObserver must be debounced (React fires hundreds of mutations/sec)
- Logs: `~/.config/Claude/logs/main.log` and `~/.cache/claude-desktop-debian/launcher.log`
- See [[project_claude_desktop_symlink_gotcha]] if deployed changes don't take effect
