---
name: project_claude_desktop_gpu_crash
description: "Claude Desktop blank/empty page = Chromium GPU process crash (#583); the launcher now detects it and disables GPU itself"
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

**Fix: nothing to do by hand any more** (corrected 2026-08-27; this file prescribed the
manual step for months after it stopped being the answer). The v3.0.0 launcher
(`launcher-common.sh`) detects that FATAL signature in its own log and disables GPU itself,
sticky until `CLAUDE_DISABLE_GPU=0`. The blanket `CLAUDE_DISABLE_GPU=1` was therefore removed
from both Exec lines - verified still absent: they read
`env CLAUDE_USE_WAYLAND=1 .../AppRun %U` - so acceleration is on by default with automatic
fallback. Setting it manually is now only a way to force the fallback early. See
[[project_claude_desktop_state]] and `maintenance.md`.

**How to apply / diagnose:** when the page is blank, check launcher.log for the GPU
FATAL before assuming custom-ui broke. Confirm the injection is still present with
`grep -a -c "custom-ui loader" <app.asar>` (it survives updates). Note: a GUI launch
from a non-interactive Claude Code bash session dies immediately (no Wayland seat) -
verification must be done by the user launching from the menu. See [[project_claude_desktop_state]].
