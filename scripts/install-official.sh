#!/usr/bin/env bash
# Installs Anthropic's OFFICIAL Claude Desktop for Linux into a private user
# prefix, side by side with the patched aaddrick build.
#
# Why a manual prefix install instead of a package:
#   - The official app ships only as a Debian/Ubuntu .deb (apt repo at
#     downloads.claude.ai). There is no Arch package from Anthropic.
#   - Every pacman route CONFLICTS with claude-desktop-appimage: that package
#     declares provides/conflicts=claude-desktop, and the official .deb owns
#     the same /usr/bin/claude-desktop and .desktop paths. Installing AUR
#     claude-desktop (or claude-desktop-extra) would REMOVE the patched build.
#   - So we unpack only the .deb's file payload into ~/.local/lib and drive it
#     with our own launcher. Nothing under /usr or /opt is touched, no sudo.
#
# The .deb's maintainer scripts (control.tar.xz) are deliberately NOT run:
# they register Anthropic's apt repo and install an Ubuntu AppArmor profile
# for the user-namespace restriction. Neither applies on Arch/Manjaro.
#
# Profile isolation: both apps are Electron appName "Claude" and would both
# claim ~/.config/Claude. Two Electron processes on one LevelDB profile can
# corrupt it, so the official build is pinned to ~/.config/ClaudeOfficial via
# --user-data-dir. Consequence: separate sign-in, separate MCP config.
#
# Safe to re-run: it is the upgrade path. Exits early if already current.
set -euo pipefail

PREFIX="$HOME/.local/lib/claude-desktop-official"
APPROOT="$PREFIX/usr/lib/claude-desktop"
USERDATA="$HOME/.config/ClaudeOfficial"
LAUNCHER="$HOME/.local/bin/claude-desktop-official"
DESKTOP="$HOME/.local/share/applications/claude-desktop-official.desktop"
ICON_NAME="claude-desktop-official"
STAMP="$PREFIX/.installed-version"

REPO="https://downloads.claude.ai/claude-desktop/apt/stable"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  DEB_ARCH=amd64 ;;
  aarch64) DEB_ARCH=arm64 ;;
  *) echo "ERROR: unsupported architecture '$ARCH' (repo publishes amd64/arm64 only)" >&2; exit 1 ;;
esac

WORKDIR=""
# Must end in a success status: an EXIT trap's last command would otherwise
# override the script's own exit code.
cleanup() { [[ -n "$WORKDIR" ]] && rm -rf "$WORKDIR"; return 0; }
trap cleanup EXIT

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

# --- 1. Resolve the newest package in the pool -------------------------------
echo "→ Querying Anthropic's apt repository index ($DEB_ARCH)..."
PKG_PATH="$(curl -fsSL "$REPO/dists/stable/main/binary-$DEB_ARCH/Packages" \
  | grep '^Filename: pool/main/c/claude-desktop/claude-desktop_' \
  | cut -d' ' -f2 | sort -V | tail -n 1)"

if [[ -z "$PKG_PATH" ]]; then
  echo "ERROR: no package found in the repository index." >&2
  echo "       Check that this network can reach downloads.claude.ai." >&2
  exit 1
fi

# claude-desktop_1.26832.0_amd64.deb -> 1.26832.0
VERSION="$(basename "$PKG_PATH" | sed -E 's/^claude-desktop_([^_]+)_.*$/\1/')"
echo "  Latest available: $VERSION"

INSTALLED="$(cat "$STAMP" 2>/dev/null || true)"
echo "  Currently installed: ${INSTALLED:-<none>}"

if [[ "$INSTALLED" == "$VERSION" && $FORCE -eq 0 ]]; then
  echo "→ Already current. Nothing to do. (Re-run with --force to reinstall.)"
  exit 0
fi

# --- 2. Download -------------------------------------------------------------
WORKDIR="$(mktemp -d -t claude-official-XXXXXX)"
# Cache the .deb so a re-run after a failed extract doesn't refetch 170 MB.
CACHE_DIR="$HOME/.cache/claude-desktop-official"
mkdir -p "$CACHE_DIR"
DEB="$CACHE_DIR/$(basename "$PKG_PATH")"
if [[ -s "$DEB" ]]; then
  echo "→ Using cached $(basename "$PKG_PATH")"
else
  echo "→ Downloading $(basename "$PKG_PATH") (~170 MB)..."
  curl -fL --progress-bar -o "$DEB.part" "$REPO/$PKG_PATH"
  mv "$DEB.part" "$DEB"
fi
# Drop older cached downloads.
find "$CACHE_DIR" -maxdepth 1 -name 'claude-desktop_*.deb' ! -name "$(basename "$DEB")" -delete

# --- 3. Extract the file payload only ----------------------------------------
echo "→ Extracting payload..."
( cd "$WORKDIR" && bsdtar -xf "$DEB" )
DATA_TAR="$(find "$WORKDIR" -maxdepth 1 -name 'data.tar.*' | head -1)"
if [[ -z "$DATA_TAR" ]]; then
  echo "ERROR: data.tar.* not found inside the .deb" >&2
  exit 1
fi

STAGE="$WORKDIR/stage"
mkdir -p "$STAGE"
bsdtar -xf "$DATA_TAR" -C "$STAGE"

if [[ ! -x "$STAGE/usr/lib/claude-desktop/claude-desktop" ]]; then
  echo "ERROR: expected entrypoint usr/lib/claude-desktop/claude-desktop not found." >&2
  echo "       Upstream may have changed the package layout." >&2
  exit 1
fi

# Swap in atomically-ish: keep the old tree until the new one is in place.
if [[ -d "$PREFIX" ]]; then
  echo "→ Replacing existing install at $PREFIX"
  rm -rf "$PREFIX.old"
  mv "$PREFIX" "$PREFIX.old"
fi
mkdir -p "$(dirname "$PREFIX")"
mv "$STAGE" "$PREFIX"
rm -rf "$PREFIX.old"

echo "$VERSION" > "$STAMP"

# --- 4. Launcher -------------------------------------------------------------
# The Electron entrypoint is usr/lib/claude-desktop/claude-desktop; upstream's
# /usr/bin/claude-desktop is just a symlink to it, which we replace with our
# own wrapper so the profile flags are always applied.
#
# Note on the sandbox: chrome-sandbox is not setuid here (we never ran as
# root), but Arch enables unprivileged user namespaces, so Chromium's namespace
# sandbox works without it. Do NOT add --no-sandbox unless launching actually
# fails with a sandbox error.
echo "→ Writing launcher: $LAUNCHER"
mkdir -p "$(dirname "$LAUNCHER")"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
# Launcher for the OFFICIAL Claude Desktop, installed by install-official.sh.
# Generated file - edit scripts/install-official.sh instead.
set -euo pipefail

APPROOT="$APPROOT"
USERDATA="$USERDATA"
EOF
cat >> "$LAUNCHER" <<'EOF'

if [[ -n "${WAYLAND_DISPLAY:-}" || "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
    export ELECTRON_OZONE_PLATFORM_HINT=wayland
fi

# Use the desktop keyring when a Secret Service provider is on the bus,
# otherwise Chromium's plaintext store (same probe the cowork launcher uses).
PW_STORE="gnome-libsecret"
if ! dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus \
     org.freedesktop.DBus.NameHasOwner string:"org.freedesktop.secrets" 2>/dev/null \
     | grep -q "boolean true"; then
    PW_STORE="basic"
fi

mkdir -p "$USERDATA"

exec "$APPROOT/claude-desktop" \
    --user-data-dir="$USERDATA" \
    --password-store="$PW_STORE" \
    --enable-features=GlobalShortcutsPortal \
    "$@"
EOF
chmod +x "$LAUNCHER"

# --- 5. Icon + desktop entry -------------------------------------------------
echo "→ Installing icon and desktop entry..."
# Pick the largest available PNG.
ICON_SRC="$(find "$PREFIX/usr/share/icons/hicolor" -path '*/apps/*.png' -printf '%s %p\n' 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2- || true)"
if [[ -n "$ICON_SRC" ]]; then
  # Mirror the icon under a distinct name so it can't collide with the
  # patched app's "claude-desktop" icon.
  SIZE_DIR="$(basename "$(dirname "$(dirname "$ICON_SRC")")")"
  DEST_DIR="$HOME/.local/share/icons/hicolor/$SIZE_DIR/apps"
  mkdir -p "$DEST_DIR"
  cp -f "$ICON_SRC" "$DEST_DIR/$ICON_NAME.png"
else
  echo "  (no icon found in payload; desktop entry will use the generic icon)"
fi

# MimeType is deliberately omitted: registering x-scheme-handler/claude here
# would hijack claude:// links away from the patched build, which stays the
# daily driver.
mkdir -p "$(dirname "$DESKTOP")"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Name=Claude (Official)
Comment=Anthropic's official Claude Desktop for Linux (beta) - isolated profile
Exec=$LAUNCHER %U
Icon=$ICON_NAME
Type=Application
Categories=Development;Utility;
StartupNotify=true
SingleMainWindow=true
# The official build's Wayland app_id / X11 WM_CLASS. Distinct from the
# patched app's "Claude", so docks group the two windows separately.
StartupWMClass=com.anthropic.Claude
EOF

command -v update-desktop-database >/dev/null 2>&1 \
  && update-desktop-database "$(dirname "$DESKTOP")" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 \
  && gtk-update-icon-cache -qtf "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true

# --- 6. Report ---------------------------------------------------------------
echo
echo "✓ Official Claude Desktop $VERSION installed."
echo "  Prefix:    $PREFIX"
echo "  Profile:   $USERDATA   (separate from the patched app's ~/.config/Claude)"
echo "  Launch:    $LAUNCHER   (or 'Claude (Official)' in your app menu)"
echo

# Cowork's VM detection probes hardcoded Debian paths. Report, don't fix:
# creating these needs root, so leave it to the user.
MISSING=()
[[ -e /usr/share/OVMF/OVMF_CODE_4M.fd || -e /usr/share/OVMF/OVMF_CODE.fd ]] || MISSING+=(ovmf)
[[ -e /usr/libexec/virtiofsd || -e /usr/bin/virtiofsd ]] || MISSING+=(virtiofsd)
if (( ${#MISSING[@]} )); then
  echo "! Cowork will report \"requires QEMU\": it probes Debian paths that don't"
  echo "  exist on Arch (missing: ${MISSING[*]}). To fix, run once as root:"
  echo
  echo "    sudo mkdir -p /usr/share/OVMF /usr/libexec"
  echo "    sudo ln -sf /usr/share/edk2-ovmf/x64/OVMF_CODE.4m.fd /usr/share/OVMF/OVMF_CODE_4M.fd"
  echo "    sudo ln -sf /usr/share/edk2-ovmf/x64/OVMF_VARS.4m.fd /usr/share/OVMF/OVMF_VARS_4M.fd"
  echo "    sudo ln -sf /usr/lib/virtiofsd /usr/libexec/virtiofsd"
  echo
fi
