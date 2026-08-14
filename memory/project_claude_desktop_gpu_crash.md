---
name: project_claude_desktop_gpu_crash
description: "Claude Desktop blank/empty page = Chromium GPU process crash (#583); fix is CLAUDE_DISABLE_GPU=1 in the .desktop Exec lines"
metadata: 
  node_type: memory
  type: project
  originSessionId: dfb61d96-ccaf-4c76-a3e4-16996b0578bd
---

Symptom: Claude Desktop shows a blank/empty page (renderer never paints, then the
app dies). Real cause is NOT our custom-ui patch - it is the Chromium GPU process
failing: `GPU process launch failed: error_code=1002` repeated, then
`FATAL ... GPU process isn't usable. Goodbye.` (seen in `~/.cache/claude-desktop-debian/launcher.log`).

This is upstream issue #583. On rolling-release Manjaro a Mesa/driver/kernel update
can break the old bundled Electron's GPU process even though our patched app binary
(2.1.149) is unchanged. First hit 2026-07-05.

**Fix:** add `CLAUDE_DISABLE_GPU=1` to the launcher env. The launcher
(`launcher-common.sh`) honors it and adds `--disable-gpu --disable-software-rasterizer`.
Applied to BOTH:
- `~/.local/share/applications/claude-desktop.desktop` (app-menu launch)
- `~/.config/autostart/claude-desktop.desktop` (login autostart)

Both Exec lines now read `env CLAUDE_USE_WAYLAND=1 CLAUDE_DISABLE_GPU=1 .../AppRun`.

**How to apply / diagnose:** when the page is blank, check launcher.log for the GPU
FATAL before assuming custom-ui broke. Confirm the injection is still present with
`grep -a -c "custom-ui loader" <app.asar>` (it survives updates). Note: a GUI launch
from a non-interactive Claude Code bash session dies immediately (no Wayland seat) -
verification must be done by the user launching from the menu. See [[project_claude_desktop_state]].
