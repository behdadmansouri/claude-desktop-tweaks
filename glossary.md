# Glossary
Emoji shorthand for this project. Use the emoji alone in chat; never re-explain what it means.

| Emoji | Means |
|---|---|
| 🎛️ | the panel / project selector / the widget: `custom-ui/workspace.js`'s project picker next to the composer, the one feature this project exists to ship |
| 🧩 | patched build / official build: the two installs, AUR `claude-desktop-appimage` at `~/.local/lib/claude-desktop-patched`, and Anthropic's own Linux app at `~/.local/lib/claude-desktop-official` (the daily driver since 2026-09-01) |
| 📍 | the workspace row: the folder/connection pill row under the new-session composer that the panel anchors to; its selectors keep breaking on claude.ai rebuilds |
| 📈 | the usage chip: `custom-ui/usage.js`'s live context/5-hour/weekly indicator, polling the app's own `/usage` endpoint instead of scraping the popover |
| 📏 | measure, don't guess: this project's standing rule, extend `diag.js`/`workspace.js` probes and read a real DOM dump from the log before writing a selector fix, never guess an anchor |
| 🧨 | the heredoc hazard: `update-ui.sh`'s python patcher block is an UNQUOTED heredoc, a stray backtick, `$(`, or backslash escape in a comment gets executed as shell, not read as text |
| ✂️ | the July scope trim: the 2026-07-12 cut-down to just the project panel, deleting `sidebar.js`/`fbar.js`/`topbar.js`/`usage.js`/`banners.js`; a recurring source of "X was deleted here" bugs (`sampleWS`, the topbar hider) |
| 🚀 | TODO simplification fleet: the reusable Sonnet-agent-per-project procedure that trims every project's `TODO.md`; invoked with "Run the TODO simplification fleet", brief stored at root `memory/reference/reference_todo_simplify_fleet.md` |
