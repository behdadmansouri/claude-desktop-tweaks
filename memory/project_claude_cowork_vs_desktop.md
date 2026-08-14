---
name: project-claude-cowork-vs-desktop
description: "Cowork is a separate AUR package (claude-cowork-linux) that CONFLICTS with claude-desktop-appimage, not a desktop feature"
metadata: 
  node_type: memory
  type: project
  originSessionId: e06f6de1-4bd1-4194-852d-4358ae339fd8
---

"Claude Cowork" is NOT a feature inside Claude Desktop. It is its own AUR package,
`claude-cowork-linux` ("Anthropic Claude Desktop with local agent support"), binary
`claude-cowork`, its own `app.asar` at `/usr/lib/claude-cowork/`.

`claude-cowork-linux` and `claude-desktop-appimage` both `provides=claude-desktop` and
list each other as `conflicts` - only ONE can be installed at a time. Installing one
auto-removes the other.

User's history (pacman.log): had claude-cowork-linux installed 2026-05-29, removed it
2026-06-01 when installing claude-desktop-appimage (the conflict forced the swap). So
"downgrade desktop to get cowork" was a misdiagnosis - nothing broke; Cowork was just
uninstalled by the package swap.

**How to apply:** To use Cowork, `yay -S claude-cowork-linux` (current AUR version
1.1.4010-10; note versioning was reset from the older 1.9659.2 cached build). This removes
claude-desktop-appimage. Reversible: reinstall `claude-desktop-appimage` to swap back.

Consequence: the `custom-ui.js` workspace-panel patch is built against the
claude-desktop-appimage asar layout - it is NOT active on Cowork (separate asar). Would
need re-porting to patch Cowork. See [[claude-desktop-patching-state]].

**Build break fixed 2026-07-13 (claude-cowork-linux 1.20186.1 / DMG build 1.1.4010):**
`makepkg` failed: "Platform-gate function not found in .../index.js". Cause: upstream moved
main-process code (platform gate `ZYt()`, `getHostPlatform()`, platform-return gates) OUT of
`.vite/build/index.js` into a content-hashed chunk (`index.chunk-zFJ_MSb3.js`) that index.js
`require()`s. `enable-cowork.py`'s regex still matches - the PKGBUILD just aimed it at the
wrong (now stub) file. Fix in yay-cache PKGBUILD build(): resolve the chunk via
`grep -oE 'index\.chunk-[A-Za-z0-9_-]+\.js' index.js | head -1` and patch that instead.
Same content-hashed-chunk pattern the desktop `update-ui.sh` already handles. Rebuild with
`makepkg -si` in `~/.cache/yay/claude-cowork-linux/` (NOT `yay -S`, which git-resets the
PKGBUILD edit). Report upstream: github.com/johnzfitch/claude-cowork-linux.
Note: "IPC origin guards: no matching sites" is benign - that patch only matters when running
unpacked from file://; this package repacks into app.asar (app:// origin).
