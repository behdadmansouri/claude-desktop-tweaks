# Feature Status

Rewritten 2026-07-12 after the scope trim - the previous version of this file listed several
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
| **TODO.md editing** (2026-08-18) | Click the rendered text to edit, click away to commit. Textarea occupies the same slot so geometry can't shift. Autosaves through `cc-write-todo-v2`, which only ever writes `TODO.md`, only under `~/Documents/AI Projects`, via temp-file + rename, snapshotting the previous version first. `revert` undoes the whole editing session; `open` reveals the folder. |
| **Top-bar removal** (2026-08-18) | `custom-ui/chrome.js`. Purely geometric match plus a self-heal that restores the element if visible text collapses. Off with `localStorage['cc-hide-topbar']='0'`. Hands window drag/close to the KDE titlebar and Ctrl+Q. |
| **Limit-nag dismissal** (2026-08-18) | "Approaching your weekly limit" toasts get their own close button clicked, so the app remembers. Off with `localStorage['cc-hide-limit-nag']='0'`. |
| **DOM beacon** (2026-08-18) | `custom-ui/diag.js`. The replacement for CDP, which is still blocked. See [debugging.md](debugging.md). |
| **Ctrl+Q quit** | Clean shutdown via IPC (channel UUID extracted dynamically at patch time - see `memory/maintenance.md`). Preload-level, not in `custom-ui/`. |
| **Project emoji on repo-named sidebar groups** (2026-08-27) | The app names a project group after its git remote when the folder has one, so those five folders showed a bare repo name. `custom-ui/labels.js` appends the folder's emoji, from a `{"owner/repo": "Folder Name"}` map `update-ui.sh` bakes out of each `.git/config`. Off with `localStorage['cc-repo-emoji']='0'` |
| **Session facts** (2026-08-27) | `custom-ui/session.js` + the `cc-session-info` IPC: the project folder, title, model and last-turn token count for the open session, read from the app's own session record and the transcript tail. One cache, shared by the title watcher and the usage chip |
| **Window title carries the project** (2026-08-27) | `Claude Desktop 🤖 · Conversation name`, so ActivityWatch can attribute time per project instead of seeing only `Code`. Conversation name comes from the session record, not the DOM |
| **Chrome band reclaimed** (2026-08-27) | `--df-chrome-bar-height` is zeroed: the app reserved 36px for window controls it no longer draws. Back with `localStorage['cc-chrome-bar']='keep'` |
| **Usage readout** (2026-08-18) | Fixed corner chip: context %, 5-hour %, weekly %, each with time-to-reset. Hover for every bucket the account has. Polls `/api/organizations/<org>/usage` (see [architecture.md](architecture.md#plan-usage-endpoint-2026-08-18-discovery)), so it is genuinely live rather than a snapshot of whatever the popover last showed. `custom-ui/usage.js` |

**Usage caveat (rewritten 2026-08-27):** the plan numbers are API-sourced and always current. The **context window** figure has no endpoint, and the app only publishes it while its own popover is open, so it is now computed from the session transcript instead (`cc-session-info`). The window *size* is not in the transcript: it is learned from the app's own `used / total` when that appears, or derived from a bare percentage plus our token count above 15%, and cached in `cc-usage-ctx-total`. Until it is known the card shows a token count with no percentage, which is the honest reading.

## Removed 2026-07-12 (verified dead - every call site was already commented out)

Usage badges, Ctrl+O/Ctrl+Shift+L/Ctrl+Shift+R/Ctrl+W/Alt+1-9/Ctrl+1-2-3 shortcuts, chat number
badges, cache ring, rate-limit ring, pin chats, startup popup auto-dismiss, "model unavailable"
banner hider, code tab auto-select, floating usage bar, top-bar padding-collapse CSS +
`patchWCOHeight()` (also independently obsolete post-v3.0.0-rebase - no WCO shim left to patch).
Deleted files: `sidebar.js`, `fbar.js`, `topbar.js`, `usage.js`, `banners.js`.

The old `usage.js` was never committed (it only ever existed inside the built `custom-ui.js`, see
`git show 0f88b61:custom-ui.js`). The 2026-08-18 `usage.js` is a **rewrite, not a restore** - the
old one scraped the popover and could not be live by construction. Nothing else on that list is
worth resurrecting speculatively.

## Not Yet Implemented

| Feature | Notes |
|---------|-------|
| **Workspace "New Project on SSH"** | Requires main-process IPC to create remote directory. Confirmed **not planned** 2026-08-26 - not worth the scope, do not re-propose |
