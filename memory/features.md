# Feature Status

Rewritten 2026-07-12 after the scope trim — the previous version of this file listed several
features as "Implemented" that were actually already disabled in code (commented-out calls in
`bootstrap.js`/`scan()`) as of the 2026-07-10 session, so it had drifted from reality. Verify
against `custom-ui/*.js` before trusting file:line detail here in future, per the memory
staleness warning.

## Implemented (the only thing left)

| Feature | Notes |
|---------|-------|
| **Workspace/project selector panel** | Hover-triggered two-column panel (Local / Myserver) on new-session pages. Local column loads live via `cc-ai-data-v2` IPC, falls back to baked `CC_AI_LOCAL`. `custom-ui/workspace.js` |
| **Workspace folder click** | Arms path via `ccBridge.armFolder(path)`; patched `browseFolder` in the main bundle returns it without an OS dialog. |
| **TODO.md previews** | Panel renders each folder's `TODO.md` as markdown on hover; live via `cc-ai-data-v2`, baked fallback via `CC_AI_TODOS`. |
| **Ctrl+Q quit** | Clean shutdown via IPC (channel UUID extracted dynamically at patch time — see `memory/maintenance.md`). Preload-level, not in `custom-ui/`. |

## Removed 2026-07-12 (verified dead — every call site was already commented out)

Usage badges, Ctrl+O/Ctrl+Shift+L/Ctrl+Shift+R/Ctrl+W/Alt+1-9/Ctrl+1-2-3 shortcuts, chat number
badges, cache ring, rate-limit ring, pin chats, startup popup auto-dismiss, "model unavailable"
banner hider, code tab auto-select, floating usage bar, top-bar padding-collapse CSS +
`patchWCOHeight()` (also independently obsolete post-v3.0.0-rebase — no WCO shim left to patch).
Deleted files: `sidebar.js`, `fbar.js`, `topbar.js`, `usage.js`, `banners.js`. If any of these
need to come back, they're in git history (see `git log -- custom-ui/`), not worth resurrecting
speculatively.

## Not Yet Implemented

| Feature | Notes |
|---------|-------|
| **Workspace "New Project on SSH"** | Requires main-process IPC to create remote directory (out of scope) |
