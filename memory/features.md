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
| **TODO.md editing** (2026-08-18) | `edit` in the preview header swaps the rendered view for a textarea in the same slot (so geometry can't shift), autosaving through `cc-write-todo`. That handler only ever writes `TODO.md`, only under `~/Documents/AI Projects`, via temp-file + rename. `open` reveals the folder in the file manager. |
| **Limit-nag dismissal** (2026-08-18) | "Approaching your weekly limit" toasts get their own close button clicked, so the app remembers. Off with `localStorage['cc-hide-limit-nag']='0'`. |
| **DOM beacon** (2026-08-18) | `custom-ui/diag.js`. The replacement for CDP, which is still blocked. See [debugging.md](debugging.md). |
| **Ctrl+Q quit** | Clean shutdown via IPC (channel UUID extracted dynamically at patch time - see `memory/maintenance.md`). Preload-level, not in `custom-ui/`. |
| **Usage readout** (2026-08-18) | Fixed corner chip: context %, 5-hour %, weekly %, each with time-to-reset. Hover for every bucket the account has. Polls `/api/organizations/<org>/usage` (see [architecture.md](architecture.md#plan-usage-endpoint-2026-08-18-discovery)), so it is genuinely live rather than a snapshot of whatever the popover last showed. `custom-ui/usage.js` |

**Usage caveat:** the plan numbers are API-sourced and always current. The **context window**
figure has no endpoint - it is only in the popover DOM - so the chip shows `ctx --` until a
popover happens to expose it. Set `localStorage['cc-usage-probe']='1'` to log candidate API
payloads while hunting for a better source.

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
| **Workspace "New Project on SSH"** | Requires main-process IPC to create remote directory (out of scope) |
