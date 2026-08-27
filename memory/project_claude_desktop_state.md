---
name: claude-desktop-patching-state
description: "Current state of the Claude Desktop patching project - what works, what broke, how to continue"
metadata: 
  node_type: memory
  type: project
  originSessionId: 32571da7-297f-43a2-94ef-bd1b5e9e2ddb
---

Claude Desktop is patched and working as of 2026-08-27. Wiki lives at `memory/` (split into multiple files, indexed by `memory/MEMORY.md`).

**Why:** User wants custom UI injected into Claude Desktop's Electron renderer via a patched asar.

**How to apply:** Start from `AGENTS.md` for file registry, then open the relevant `custom-ui/` module.

Key facts:
- Patched app is at `/home/z3z0/.local/lib/claude-desktop-patched/`, build 1.24012.9. Anthropic's official app is installed alongside it on its own profile; `claude-ctl` reports both. The patched build has no update source since its AUR package was removed (open TODO)
- `custom-ui.js` is built from modules in `custom-ui/` by `scripts/update-ui.sh`; run things via [[USAGE]]
- `update-ui.sh` embeds the combined JS into `mainView.js` inside the asar
- The top-bar hider is back as `custom-ui/chrome.js`, matching on geometry only and self-healing if hiding collapses the page's visible text; see [[issues-fixed]] #18 for why a guessed selector is never acceptable here
- The renderer knows only the route. Anything about *which session this is* - project folder, title, model, token count - comes from the `cc-session-info` IPC reading the app's own session record under `<userData>/claude-code-sessions/`, plus the transcript at `~/.claude/projects/<slug>/<cliSessionId>.jsonl`. See [[issues-fixed]] #50 and `custom-ui/session.js`
- The app names a sidebar project group after its git remote when the folder has one (`label:project-owner/repo`), not after the folder. That is why five folders lost their emoji; `custom-ui/labels.js` puts it back
- Sidebar DOM (dframe): chat rows are `<div data-row>` + `<button data-row-main-button>`; no chat ID in DOM; key on chat title from "More options" aria-label; active chat has `data-selected`
- MutationObserver must be debounced (React fires hundreds of mutations/sec)
- Logs: `~/.config/Claude/logs/main.log` and `~/.cache/claude-desktop-debian/launcher.log`
- See [[project_claude_desktop_symlink_gotcha]] if deployed changes don't take effect
