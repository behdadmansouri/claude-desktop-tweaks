# Index
Files in this folder.

| File | Purpose |
|------|---------|
| `cdp.py` | Live DOM introspection of the running app over Chrome DevTools Protocol |
| `install.sh` | UI patcher installer, Linux and macOS |
| `install.ps1` | UI patcher installer, Windows |
| `remote-scan.sh` | Runs ON each ssh host (embedded by `update-ui.sh`, not copied there): lists `~/AI Projects/*`, last commit, session and TODO mtimes, TODO text. Read-only. A file so its dollar signs never meet the unquoted heredoc |
| `update-ui.sh` | Patch + deploy tool. `--official` targets the official build instead, `--prefix DIR` anything else. Also makes "keep computer awake" mean *while working*: it rewrites the app's `keepAwakeEnabled` claim to consult `__ccWorkActive()` and re-checks every 60s |
| `check-updates.sh` | Background update check: official build vs the apt index, the patched build vs the AUR, and whether the deployed asar is stale relative to `custom-ui/`. `--report` prints the last result offline. Reports only - never installs. Run at session start by the hook in `.claude/settings.json` |
| `install-official.sh` | Installs/updates Anthropic's **official** Linux app into `~/.local/lib/claude-desktop-official` on an isolated profile, side by side with the patched build. Does not touch it. |
| `claude-quit.sh` | Kill all Claude processes |
