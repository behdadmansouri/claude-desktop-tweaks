#!/usr/bin/env bash
# Background update check for both Claude Desktop builds, plus a "is the patch
# still current" check for this repo.
#
# Deliberately does NOT install anything. Every install path here needs either
# sudo (AUR) or several minutes and ~170 MB (official .deb), and a session-start
# hook is the wrong place to spend either without being asked. It answers the
# question and writes the answer down; acting on it stays a decision.
#
#   --report   print the LAST result and exit immediately (no network).
#   (default)  run the checks and rewrite the cached result.
#
# The session-start hook does `--report` first (instant, offline) and then kicks
# off a refresh in the background, so the answer shown is at most one session
# old and the session never waits on the network.
set -uo pipefail

CACHE_DIR="$HOME/.cache/claude-desktop-tweaks"
STATUS="$CACHE_DIR/update-status"
LOCK="$CACHE_DIR/update-check.lock"
mkdir -p "$CACHE_DIR"

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PATCHED_ASAR="$HOME/.local/lib/claude-desktop-patched/usr/lib/claude-desktop/resources/app.asar"
OFFICIAL_STAMP="$HOME/.local/lib/claude-desktop-official/.installed-version"
REPO="https://downloads.claude.ai/claude-desktop/apt/stable"

if [[ "${1:-}" == "--report" ]]; then
  if [[ -s "$STATUS" ]]; then cat "$STATUS"; else echo "claude-desktop: no update check has run yet"; fi
  exit 0
fi

# One checker at a time. flock is in util-linux; if it is somehow missing, just
# run - a duplicate check is harmless, it only costs two HTTP requests.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK"
  flock -n 9 || exit 0
fi

out=()

# ── 1. Anthropic's official build ────────────────────────────────────────────
case "$(uname -m)" in
  x86_64)  deb_arch=amd64 ;;
  aarch64) deb_arch=arm64 ;;
  *)       deb_arch="" ;;
esac
if [[ -n "$deb_arch" ]]; then
  latest="$(curl -fsSL --max-time 15 "$REPO/dists/stable/main/binary-$deb_arch/Packages" 2>/dev/null \
    | grep '^Filename: pool/main/c/claude-desktop/claude-desktop_' \
    | cut -d' ' -f2 | sed -E 's/^.*claude-desktop_([^_]+)_.*$/\1/' | sort -V | tail -n1)"
  installed="$(cat "$OFFICIAL_STAMP" 2>/dev/null || true)"
  if [[ -z "$latest" ]]; then
    out+=("official: could not reach downloads.claude.ai")
  elif [[ -z "$installed" ]]; then
    out+=("official: not installed (latest $latest) - scripts/install-official.sh")
  elif [[ "$installed" == "$latest" ]]; then
    out+=("official: current ($installed)")
  else
    out+=("official: $installed -> $latest AVAILABLE - scripts/install-official.sh")
  fi
fi

# ── 2. The patched build's upstream package ──────────────────────────────────
# claude-desktop-appimage was dropped from the AUR on 2026-08-14, which is why
# scripts/update-appimage.sh cannot work. Re-checked each run rather than
# hardcoded, because it may well come back.
have="$(pacman -Q claude-desktop-appimage 2>/dev/null | awk '{print $2}')"
aur="$(curl -fsSL --max-time 15 \
  'https://aur.archlinux.org/rpc/v5/info?arg[]=claude-desktop-appimage' 2>/dev/null \
  | grep -o '"Version":"[^"]*"' | head -1 | cut -d'"' -f4)"
if [[ -z "$have" ]]; then
  out+=("patched: claude-desktop-appimage not installed")
elif [[ -z "$aur" ]]; then
  out+=("patched: $have installed; package still absent from the AUR (pinned)")
elif [[ "$have" == "$aur" ]]; then
  out+=("patched: current ($have)")
else
  out+=("patched: $have -> $aur AVAILABLE - scripts/update-appimage.sh")
fi

# ── 3. Is the deployed asar built from the current sources? ──────────────────
# The single most common way this project breaks is editing custom-ui/ and
# forgetting to re-run update-ui.sh, which looks exactly like "the fix didn't
# work". Comparing mtimes catches it for free.
if [[ -f "$PATCHED_ASAR" ]]; then
  newest="$(find "$PROJECT_DIR/custom-ui" "$SCRIPT_DIR/update-ui.sh" -type f -newer "$PATCHED_ASAR" 2>/dev/null | head -5)"
  if [[ -n "$newest" ]]; then
    n="$(printf '%s\n' "$newest" | wc -l)"
    out+=("patch: STALE - $n source file(s) newer than the deployed asar - ./scripts/update-ui.sh")
  else
    out+=("patch: deployed asar is up to date with custom-ui/")
  fi
fi

{
  printf 'claude-desktop update check - %s\n' "$(date '+%Y-%m-%d %H:%M')"
  printf '  %s\n' "${out[@]}"
} > "$STATUS.tmp" && mv -f "$STATUS.tmp" "$STATUS"

cat "$STATUS"
