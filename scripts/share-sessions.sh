#!/usr/bin/env bash
# Make the official build show the same Claude Code session list as the patched
# one, by pointing its session index at the patched profile's.
#
# WHAT IS AND IS NOT PER-PROFILE (measured 2026-08-25)
#
#   already shared, nothing to do:
#     ~/.claude/projects/            the actual conversation transcripts, 257M.
#                                    Lives under $HOME, not under a profile, so
#                                    both builds already read the same files.
#     claude.ai conversations        server-side, same account. Never local.
#
#   per-profile, and the reason the Code tab looks empty in the official build:
#     <profile>/claude-code-sessions/<org>/<account>/local_*.json
#                                    the session INDEX - title, cwd, model,
#                                    effort, permission mode, MCP tool state.
#                                    347 records in the patched profile, 0 in
#                                    the official one.
#
# So linking the index is the whole job: the transcripts those records point at
# are already visible to both.
#
# NOT symlinked, deliberately: the rest of the profile. Both builds are Electron
# appName "Claude", and sharing Local Storage / IndexedDB / Cookies between two
# Electron processes risks LevelDB corruption. The session index is plain
# per-session JSON files, which is why it is safe to share and the rest is not.
#
# Running both builds at once against the shared index is FINE. That was an
# over-cautious warning in the first version of this script; the directory was
# then actually looked at:
#
#   347 local_*.json          one file per session, written only by the app that
#                             owns that session - two apps cannot collide
#    18 deleted_*
#     1 scheduled-tasks.json   <- the only shared mutable file
#
# So the whole race surface is that one file, plus deliberately opening the SAME
# session in both apps. Both are small and recoverable. The thing that genuinely
# cannot be shared is the rest of the profile - Local Storage / IndexedDB /
# Session Storage are LevelDB, which corrupts under two live processes, and
# Electron guards it with a SingletonLock. That is why the profiles stay split
# and only this one directory is linked.
#
# Reverse it with: --undo
set -euo pipefail

PAT="$HOME/.config/Claude/claude-code-sessions"
OFF="$HOME/.config/ClaudeOfficial/claude-code-sessions"

if [[ "${1:-}" == "--undo" ]]; then
  if [[ ! -L "$OFF" ]]; then
    echo "Not a symlink; nothing to undo."
    exit 0
  fi
  rm "$OFF"
  # Newest backup wins.
  BAK="$(ls -1d "$OFF".bak-* 2>/dev/null | sort | tail -1 || true)"
  if [[ -n "$BAK" ]]; then
    mv "$BAK" "$OFF"
    echo "Restored the official build's own session index from $BAK"
  else
    mkdir -p "$OFF"
    echo "No backup found; created an empty session index instead."
  fi
  exit 0
fi

# Warn rather than refuse. The swap itself is a mv plus a symlink, and an app
# holding a file open keeps reading the old inode until it reopens - so the only
# real cost of doing this live is that the official build shows a stale list
# until it is restarted.
if pgrep -f "claude-desktop-official" >/dev/null 2>&1; then
  echo "NOTE: the official build is running; restart it afterwards to see the shared list." >&2
fi

if [[ ! -d "$PAT" ]]; then
  echo "ERROR: patched profile has no session index at $PAT" >&2
  exit 1
fi

if [[ -L "$OFF" ]]; then
  echo "Already linked: $OFF -> $(readlink "$OFF")"
  exit 0
fi

if [[ -e "$OFF" ]]; then
  BAK="$OFF.bak-$(date +%Y%m%d-%H%M%S)"
  mv "$OFF" "$BAK"
  echo "Backed up the official build's own index -> $BAK"
fi

ln -s "$PAT" "$OFF"
echo "Linked $OFF -> $PAT"
COUNT="$(find "$OFF"/*/*/ -maxdepth 1 -name 'local_*.json' 2>/dev/null | wc -l)"
echo "The official build now sees $COUNT session records."
