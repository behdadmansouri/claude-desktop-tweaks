# Index
Files in this folder.

| File | Purpose |
|------|---------|
| `css.js` | Base CSS injection (sidebar leading-slot spacing, dark-mode workspace-panel override) |
| `workspace.js` | The project selector panel: two-pane box sized from the viewport, folder click, pinned markdown preview of any `.md`/`.txt` in the folder (local via IPC, remote via ssh), emoji/short/full name modes, yields to the app's own dialogs, `emojiSuffix`, `_seenDialogs` |
| `overview.js` | What makes 30+ projects usable: Active / Waiting on you / Parked / Dormant lanes sorted by last Claude session, the live-session dot, the Inbox of every open 🧍 / Needs-your-call item, and the per-host remote scan cache. Data over `cc-activity-v1` and `cc-scan-remote-v1` |
| `session.js` | What the current route is a session *of*: project folder, title, model, and the last turn's token count, via the `cc-session-info` IPC (the app's own session record + the transcript tail). One cache shared by the title watcher and the usage chip |
| `labels.js` | Puts the folder's emoji back on sidebar project groups that the app names after a git remote (`label:project-owner/repo`) instead of after their folder. Map baked from each folder's `.git/config` by `update-ui.sh` as `CC_AI_REPOS`; `cc-repo-emoji=0` disables |
| `usage.js` | Live usage chip (context / 5-hour / weekly + time to reset). Polls `/api/organizations/<org>/usage` - the app's own tray-usage endpoint - instead of scraping the popover, which is why it can actually stay current. Debug with `window.__ccUsage()`. Endpoint + payload shape: `memory/architecture.md` |
| `diag.js` | DOM beacon. CDP is blocked, so this is how a selector gets *measured* instead of guessed: one JSON line to the renderer log with usage buttons, top-bar drag regions, what constrains the chat column's width, and any limit nags. `window.__ccDump()`, or automatically 6s after load unless `localStorage['cc-diag']='0'` |
| `bootstrap.js` | Scan loop + bootstrap (`injectBaseCSS` + `installUsage` + `dgBootstrap` + `installPanel` + `dismissLimitNags`) |
| `titlewatch.js` | Sets `document.title` to the project folder plus the active session/conversation title (`Claude Desktop 🤖 · Sidebar emoji fix`) so outside tools can read it. The app resets it to "Claude" on navigation, so it re-applies on a MutationObserver. Debug with `window.__ccTitleDebug()` in DevTools. Consumed by the Timekeeper project's ActivityWatch window watcher, which otherwise only ever sees the window titled "Claude" |
