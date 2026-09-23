# Index
Files in this folder.

| File | Purpose |
|------|---------|
| `remote-scan.sh` | Runs ON each ssh host (embedded by `update-ui.sh`, not copied there): lists `~/AI Projects/*`, last commit, session and TODO mtimes, TODO text. Read-only. A file so its dollar signs never meet the unquoted heredoc |
| `update-ui.sh` | Patch + deploy tool. `--official` targets the official build instead, `--prefix DIR` anything else. Also makes "keep computer awake" mean *while working*: it rewrites the app's `keepAwakeEnabled` claim to consult `__ccWorkActive()` and re-checks every 60s |
| `claude-ctl.sh` | **The control surface.** `claude-ctl` (on PATH via `~/.local/bin`) shows versions, which build is running, which main-process patches are applied, patch freshness, session sharing, and every power/lock inhibitor KDE currently holds. Also acts: `patch`, `update`, `share`/`unshare`, `quit`, `json`, `page` |
| `render-dashboard.py` | Renders `claude-ctl json` into a self-contained `dashboard.html` (no server, no network, light+dark). Separate file, not a heredoc, precisely because of the heredoc hazard below |
| `install-autoupdate.sh` | systemd **--user** timer that runs `claude-ctl update` every 2h. Never passes `--force`, so it does nothing while the app is running - it acts in the window after you quit. `--status` / `--remove` |
| `share-sessions.sh` | Points the official build's Code-tab session index at the patched profile's, so both show the same sessions. Only `claude-code-sessions/` is linked - transcripts are already shared. `--undo` reverses it |
| `check-updates.sh` | Background update check: official build vs the apt index, the patched build vs the AUR, and whether the deployed asar is stale relative to `custom-ui/`. `--report` prints the last result offline. Reports only - never installs. Run at session start by the hook in `.claude/settings.json` |
| `update-appimage.sh` | Updates the AUR package + re-extracts + re-patches in one go (calls `update-ui.sh`) |
| `install-official.sh` | Installs/updates Anthropic's **official** Linux app into `~/.local/lib/claude-desktop-official` on an isolated profile, side by side with the patched build. Does not touch it. |
| `claude-quit.sh` | Kill all Claude processes |
