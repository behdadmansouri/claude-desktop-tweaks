# Maintenance

## Deploy a change

```bash
# 1. Edit the relevant module in custom-ui/
# 2. Re-patch and deploy
./scripts/update-ui.sh
```

**Do NOT run `claude-quit` automatically (2026-07-10 user instruction).** Build and deploy
the asar, then tell the user the app needs a manual quit+relaunch to pick it up - let them
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

## The official Anthropic app, installed alongside (2026-08-09)

Anthropic's official Linux app is in beta and ships **only** as a Debian/Ubuntu `.deb` from
`downloads.claude.ai`. It is installed here into a private user prefix so it does not disturb
the patched build:

```bash
./scripts/install-official.sh          # install, or upgrade in place; --force to reinstall
~/.local/bin/claude-desktop-official   # launch (or "Claude (Official)" in the app menu)
```

Why not a package: `claude-desktop-appimage` declares `provides/conflicts=claude-desktop`, and
the official `.deb` owns the same `/usr/bin/claude-desktop` and `.desktop` paths. Installing AUR
`claude-desktop` (which is also stale, 1.24012.9) or `claude-desktop-extra` would **remove the
patched build**. So the script unpacks only `data.tar.xz` into
`~/.local/lib/claude-desktop-official/` and drives it with its own launcher. The `.deb`'s
maintainer scripts are never run -- they register Anthropic's apt repo and install an Ubuntu
AppArmor profile, neither of which applies here. No sudo, nothing under `/usr` or `/opt`.

Layout gotchas found while writing it:
- Entrypoint is `usr/lib/claude-desktop/**claude-desktop**` (not `claude`, despite what the
  `claude-desktop-extra` PKGBUILD comment implies -- that name is specific to their own tarball).
  Upstream's `/usr/bin/claude-desktop` is just a symlink to it.
- Upstream's desktop file is `com.anthropic.Claude.desktop` with
  `StartupWMClass=com.anthropic.Claude` -- distinct from the patched app's `Claude`, so docks
  group them separately. Our generated entry reuses that WM class.
- The payload's icon is named `claude-desktop.png`, the same as the patched app's. The script
  re-installs it as `claude-desktop-official` to avoid the collision.
- Our entry deliberately omits `MimeType=x-scheme-handler/claude` so `claude://` links keep
  opening the patched build.

Profile isolation: both apps are Electron appName `Claude` and would both claim
`~/.config/Claude`. The launcher pins the official one to `~/.config/ClaudeOfficial` via
`--user-data-dir`. Consequences: a separate sign-in, and MCP servers from
`claude_desktop_config.json` are not shared.

Not carried over to the official app: the project selector panel and `titlewatch.js`. Its window
title stays `"Claude"`, so the Timekeeper/ActivityWatch window watcher gets nothing useful from
it -- only matters if it ever becomes the daily driver.

No auto-update: re-run `install-official.sh`, which resolves the newest version from the repo
index and exits early when already current. Downloads are cached in
`~/.cache/claude-desktop-official/`.

Cowork's VM detection probes hardcoded Debian paths in this build too; the symlinks documented
in `project_cowork_linux_vm_deps.md` were already in place, so Cowork works without extra steps.
The script checks for them and prints the fix if they're missing.

## Testing after any change

Run `./scripts/update-ui.sh`, fully quit the app, restart, verify `[custom-ui] ok` in the
console and confirm visually. The injection fails gracefully -- errors are caught and logged,
they don't kill the app.
