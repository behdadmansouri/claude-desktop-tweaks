# Maintenance

## Deploy a change

```bash
# 1. Edit the relevant module in custom-ui/
# 2. Re-patch and deploy
./scripts/update-ui.sh
```

**Do NOT run `claude-quit` automatically (2026-07-10 user instruction).** Build and deploy
the asar, then tell the user the app needs a manual quit+relaunch to pick it up — let them
do that themselves rather than killing their running session for them.

## After renaming/adding/removing AI Projects folders

```bash
./scripts/update-ui.sh   # re-bakes CC_AI_LOCAL into the asar
```

Then fully quit + relaunch. The workspace panel reads the baked folder list.

## After a new Claude Desktop AppImage release (updated 2026-07-24: one-shot script)

The AppImage at `/opt/claude-desktop/` is a distro package (AUR: `claude-desktop-appimage`,
maintained by aaddrick/claude-desktop-debian), NOT a self-updating Electron app -- the old
`~/.local/share/claude/versions/` self-update folder is gone as of the v3.0.0 rebase.

`scripts/update-appimage.sh` automates the whole flow below (see the
`update-claude-desktop` skill at `~/.claude/skills/update-claude-desktop/` for the
one-line invocation):

```bash
~/Documents/AI\ Projects/Claude\ Desktop\ 🤖/scripts/update-appimage.sh
```

It does, in order:
```bash
# 1. Update the AUR package (needs sudo -- yay will prompt)
yay -S claude-desktop-appimage

# 2. Extract the new app.asar (note: v3.0.0+ layout, not the old node_modules/electron path)
cd /tmp && rm -rf squashfs-root
/opt/claude-desktop/claude-desktop.AppImage --appimage-extract
find squashfs-root -iname app.asar   # usr/lib/claude-desktop/resources/app.asar

# 3. Back up and replace the patched app directory wholesale (layout can change between
#    packager releases -- safer to start from the fresh extract than patch in place)
cp -a ~/.local/lib/claude-desktop-patched ~/.local/lib/claude-desktop-patched.bak-$(date +%Y%m%d)
rm -rf ~/.local/lib/claude-desktop-patched
cp -a /tmp/squashfs-root ~/.local/lib/claude-desktop-patched

# 4. Run update-ui.sh -- it now self-bootstraps: if mainView.js has no "custom-ui loader"
#    sentinel yet (fresh asar), it inserts the loader + Ctrl+Q handler for the first time
#    instead of requiring a manual pre-patch. It also locates the main-process bundle by
#    content signature (content-hashed chunk filename, changes every release) rather than
#    by a hardcoded "index.js" path, and extracts the per-build eipc UUID from mainView.js
#    dynamically for the Ctrl+Q IPC channel.
~/Documents/AI\ Projects/Claude\ Desktop\ 🤖/scripts/update-ui.sh
```

The script skips step 3 (no-ops) if the AUR package version didn't change, but always
re-runs `update-ui.sh` so local edits to `custom-ui/` still get picked up.

**Things that changed in the v3.0.0 rebase (2026-07-12):** the packager now repackages
Anthropic's official Linux Electron build directly, so the old `frame-fix-entry.js` /
`frame-fix-wrapper.js` / WCO shim in `mainView.js` are gone entirely -- the official build
handles the window frame natively and no longer needs that patch. If a future release
reintroduces frame issues, check `mainView.js` for `windowControlsOverlay` again before
assuming the shim needs to come back.

**GPU acceleration:** the new launcher (`launcher-common.sh`) auto-detects the actual
Chromium "GPU process isn't usable" FATAL crash signature in its own log and only disables
GPU when that's genuinely happened (sticky until `CLAUDE_DISABLE_GPU=0`). We removed the
blanket `CLAUDE_DISABLE_GPU=1` from both `.desktop` Exec lines (`~/.local/share/applications/`
and `~/.config/autostart/`) so hardware acceleration is on by default again, with automatic
fallback if it actually crashes.

## Testing after any change

Run `./scripts/update-ui.sh`, fully quit the app, restart, verify `[custom-ui] ok` in the
console and confirm visually. The injection fails gracefully -- errors are caught and logged,
they don't kill the app.
