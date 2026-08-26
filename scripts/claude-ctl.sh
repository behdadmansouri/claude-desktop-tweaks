#!/usr/bin/env bash
# One control surface for both Claude Desktop builds.
#
#   claude-ctl                 status, human-readable (default)
#   claude-ctl json [FILE]     the same state as JSON (default: cache dir)
#   claude-ctl page [FILE]     regenerate the self-contained status page
#   claude-ctl patch [--official]
#   claude-ctl update [--force]   install what is available, then re-patch
#   claude-ctl share | unshare
#   claude-ctl quit
#
# SCOPE: this laptop only. Paths under ~/.local/lib and ~/.config are this
# machine's installs; nothing here is portable to another host as-is.
#
# The network check is NOT reimplemented here - check-updates.sh owns it and
# caches its answer. This script reads that cache and adds the local state
# (running? patched? shared? holding an inhibitor?) that needs no network.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

PATCHED_ROOT="$HOME/.local/lib/claude-desktop-patched"
OFFICIAL_ROOT="$HOME/.local/lib/claude-desktop-official"
PATCHED_ASAR="$PATCHED_ROOT/usr/lib/claude-desktop/resources/app.asar"
OFFICIAL_ASAR="$OFFICIAL_ROOT/usr/lib/claude-desktop/resources/app.asar"
PATCHED_PROFILE="$HOME/.config/Claude"
OFFICIAL_PROFILE="$HOME/.config/ClaudeOfficial"
OFFICIAL_STAMP="$OFFICIAL_ROOT/.installed-version"

CACHE_DIR="$HOME/.cache/claude-desktop-tweaks"
STATUS="$CACHE_DIR/update-status"
JSON_OUT="$CACHE_DIR/state.json"
PAGE_OUT="$CACHE_DIR/dashboard.html"
mkdir -p "$CACHE_DIR"

# ── probes ───────────────────────────────────────────────────────────────────
# Each answers one question and prints one token, so both the text and the JSON
# renderers can use them without either becoming the source of truth.

# Match on the install prefix, not the word "claude": the CLI, this script and
# any editor with the word in its path would all match otherwise.
running_patched()  { pgrep -f "$PATCHED_ROOT/usr/lib/claude-desktop/claude-desktop"  >/dev/null 2>&1; }
running_official() { pgrep -f "$OFFICIAL_ROOT/usr/lib/claude-desktop/claude-desktop" >/dev/null 2>&1; }

patched_version() {
  pacman -Q claude-desktop-appimage 2>/dev/null | awk '{print $2}' || true
}
official_version() { cat "$OFFICIAL_STAMP" 2>/dev/null || true; }

# Is the deployed asar built from the current sources? Same mtime comparison
# check-updates.sh uses; duplicated because it is three lines and needs no net.
patch_stale() {
  local asar="$1"
  [[ -f "$asar" ]] || return 1
  [[ -n "$(find "$PROJECT_DIR/custom-ui" "$SCRIPT_DIR/update-ui.sh" -type f -newer "$asar" 2>/dev/null | head -1)" ]]
}

# Does this asar carry our patches at all? Cheap substring probe on the archive
# rather than an extract - the markers are plain strings in the bundle.
asar_has_patch() {
  local asar="$1" marker="$2"
  [[ -f "$asar" ]] && grep -qaF "$marker" "$asar" 2>/dev/null
}

sessions_shared() { [[ -L "$OFFICIAL_PROFILE/claude-code-sessions" ]]; }

session_count() {
  find "$PATCHED_PROFILE/claude-code-sessions" -name 'local_*.json' 2>/dev/null | wc -l
}

# Everything currently stopping the machine from sleeping or locking, straight
# from KDE's policy agent. This is the ground truth the battery applet shows.
inhibitors() {
  command -v qdbus6 >/dev/null 2>&1 || { echo "(qdbus6 not installed)"; return; }
  qdbus6 --literal org.kde.Solid.PowerManagement.PolicyAgent \
    /org/kde/Solid/PowerManagement/PolicyAgent ListInhibitions 2>/dev/null \
    | sed 's/^\[Argument: aas {//; s/}\]$//' \
    | sed 's/}, {/\n/g; s/[{}"]//g' \
    | sed 's/^ *//' \
    | grep -v '^$' || echo "(none)"
}

# Whether the keep-awake governor currently considers itself working. Read from
# the app's own log rather than recomputed, so this reports what the app
# actually did, not what we think it should have done.
#
# It reads the app's OWN "[keep-awake] started/stopped" lines, not our
# "[cc-keep-awake]" ones. Ours go through a bare console.log in the main
# process, which electron-log's file transport does not capture - so grepping
# for them found nothing and this printed "governor not active" while the
# governor was visibly claiming and releasing the blocker every half hour
# (2026-08-26). The app's own lines are the evidence that survives a restart:
# the unpatched build claims once at startup and never releases, so a "stopped"
# line existing at all is proof the governor is running.
keepawake_state() {
  local log="$PATCHED_PROFILE/logs/main.log"
  [[ -f "$log" ]] || { echo "unknown (no main.log)"; return; }
  local last
  last="$(grep -a 'keep-awake\] \(started\|stopped\)' "$log" 2>/dev/null | tail -1)"
  [[ -n "$last" ]] || { echo "no claim recorded"; return; }

  local held="blocking sleep" when="${last:0:16}"
  [[ "$last" == *stopped* ]] && held="sleep allowed"

  if grep -qa 'keep-awake\] stopped' "$log" 2>/dev/null; then
    echo "$held since $when - governor active"
  else
    echo "$held since $when - legacy claim, governor not active (restart pending)"
  fi
}

# Why it is blocking. The predicate is "some local_*.json under the profile's
# claude-code-sessions was touched inside the idle window", so the answer is
# always a file and an age. Printing it turns "why is this thing awake" from a
# guess into a fact - and shows that merely opening the app, which rewrites a
# session file, counts as work for a full window.
keepawake_reason() {
  local root="$PATCHED_PROFILE/claude-code-sessions"
  local win="${CC_KEEPAWAKE_IDLE_MIN:-30}"
  [[ -d "$root" ]] || { echo "no session store at $root"; return; }
  local newest age
  newest="$(find "$root" -name 'local_*.json' -printf '%T@\n' 2>/dev/null | sort -rn | head -1)"
  [[ -n "$newest" ]] || { echo "no session files - idle"; return; }
  age=$(( ($(date +%s) - ${newest%%.*}) / 60 ))
  if [[ $age -lt $win ]]; then
    echo "newest session file ${age}m old, window ${win}m - counts as working"
  else
    echo "newest session file ${age}m old, window ${win}m - counts as idle"
  fi
}

# ── status ───────────────────────────────────────────────────────────────────
cmd_status() {
  local yes=" yes" no="  no"
  echo "Claude Desktop control - $(date '+%Y-%m-%d %H:%M')"
  echo
  printf '  %-22s %-26s %-9s %s\n' "BUILD" "VERSION" "RUNNING" "CUSTOM UI"
  printf '  %-22s %-26s %-9s %s\n' "patched (daily)" "$(patched_version)" \
    "$(running_patched  && echo "$yes" || echo "$no")" \
    "$(asar_has_patch "$PATCHED_ASAR"  'cc-ai-data-v2' && echo yes || echo no)"
  printf '  %-22s %-26s %-9s %s\n' "official" "$(official_version)" \
    "$(running_official && echo "$yes" || echo "$no")" \
    "$(asar_has_patch "$OFFICIAL_ASAR" 'cc-ai-data-v2' && echo yes || echo no)"
  echo
  echo "  Patch freshness:"
  if patch_stale "$PATCHED_ASAR"; then
    echo "    patched   STALE - sources newer than the deployed asar (claude-ctl patch)"
  else
    echo "    patched   current"
  fi
  echo
  echo "  Main-process patches (patched build):"
  printf '    %-22s %s\n' "native window frame" \
    "$(asar_has_patch "$PATCHED_ASAR" '__ccNativeFrame' && echo applied || echo 'not applied')"
  printf '    %-22s %s\n' "work-aware keep-awake" \
    "$(asar_has_patch "$PATCHED_ASAR" '__ccWorkActive' && echo applied || echo 'not applied')"
  echo
  echo "  Sessions:"
  if sessions_shared; then
    echo "    shared with the official build ($(session_count) records)"
  else
    echo "    NOT shared - official build keeps its own list (claude-ctl share)"
  fi
  echo "    keep-awake: $(keepawake_state)"
  echo "                $(keepawake_reason)"
  echo
  echo "  Power/lock inhibitors held right now:"
  inhibitors | sed 's/^/    /'
  echo
  echo "  Update check (cached):"
  if [[ -s "$STATUS" ]]; then sed 's/^/    /' "$STATUS"; else echo "    never run"; fi
}

# ── json ─────────────────────────────────────────────────────────────────────
# Emitted with python so the strings are escaped properly; hand-rolled JSON in
# shell breaks the first time a version or a path contains a quote.
cmd_json() {
  local out="${1:-$JSON_OUT}"
  PATCHED_VER="$(patched_version)" \
  OFFICIAL_VER="$(official_version)" \
  PATCHED_RUN="$(running_patched && echo 1 || echo 0)" \
  OFFICIAL_RUN="$(running_official && echo 1 || echo 0)" \
  PATCHED_UI="$(asar_has_patch "$PATCHED_ASAR" 'cc-ai-data-v2' && echo 1 || echo 0)" \
  OFFICIAL_UI="$(asar_has_patch "$OFFICIAL_ASAR" 'cc-ai-data-v2' && echo 1 || echo 0)" \
  FRAME="$(asar_has_patch "$PATCHED_ASAR" '__ccNativeFrame' && echo 1 || echo 0)" \
  KEEPAWAKE="$(asar_has_patch "$PATCHED_ASAR" '__ccWorkActive' && echo 1 || echo 0)" \
  STALE="$(patch_stale "$PATCHED_ASAR" && echo 1 || echo 0)" \
  SHARED="$(sessions_shared && echo 1 || echo 0)" \
  SESSIONS="$(session_count)" \
  KASTATE="$(keepawake_state)" \
  INHIBITORS="$(inhibitors)" \
  UPDATES="$(cat "$STATUS" 2>/dev/null || echo 'never run')" \
  python3 -c '
import json, os, time
g = os.environ.get
print(json.dumps({
    "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
    "builds": [
        {"name": "patched (daily driver)", "version": g("PATCHED_VER") or "unknown",
         "running": g("PATCHED_RUN") == "1", "customUI": g("PATCHED_UI") == "1"},
        {"name": "official", "version": g("OFFICIAL_VER") or "not installed",
         "running": g("OFFICIAL_RUN") == "1", "customUI": g("OFFICIAL_UI") == "1"},
    ],
    "patches": {"nativeFrame": g("FRAME") == "1", "workAwareKeepAwake": g("KEEPAWAKE") == "1"},
    "patchStale": g("STALE") == "1",
    "sessions": {"shared": g("SHARED") == "1", "count": int(g("SESSIONS") or 0)},
    "keepAwake": g("KASTATE"),
    "inhibitors": [l.strip() for l in g("INHIBITORS", "").splitlines() if l.strip()],
    "updates": g("UPDATES"),
}, indent=2))
' > "$out.tmp" && mv -f "$out.tmp" "$out"
  echo "$out"
}

# ── page ─────────────────────────────────────────────────────────────────────
# Self-contained: the state is inlined at generation time, so the file works
# from file:// with no server and no network. Regenerate to refresh.
cmd_page() {
  local out="${1:-$PAGE_OUT}"
  local tmpjson="$CACHE_DIR/.state-for-page.json"
  cmd_json "$tmpjson" >/dev/null
  PAGE_TARGET="$out" STATE_FILE="$tmpjson" python3 "$SCRIPT_DIR/render-dashboard.py"
  echo "$out"
}

# ── actions ──────────────────────────────────────────────────────────────────
cmd_patch()   { "$SCRIPT_DIR/update-ui.sh" "$@"; }
cmd_share()   { "$SCRIPT_DIR/share-sessions.sh"; }
cmd_unshare() { "$SCRIPT_DIR/share-sessions.sh" --undo; }
cmd_quit()    { "$SCRIPT_DIR/claude-quit.sh"; }

# Install whatever is available, then re-patch on top.
#
# Refuses while either build is running unless --force. An app update replaces
# the asar the running Electron process has MMAPPED; doing that live is how you
# get a half-read bundle and a crash, and it would also throw away whatever
# session you are in the middle of.
cmd_update() {
  local force=0
  [[ "${1:-}" == "--force" ]] && force=1
  if [[ $force -eq 0 ]] && { running_patched || running_official; }; then
    echo "Claude Desktop is running - not updating mid-session." >&2
    echo "Quit it first (claude-ctl quit), or pass --force." >&2
    return 3
  fi

  echo "→ Refreshing update check..."
  "$SCRIPT_DIR/check-updates.sh" >/dev/null 2>&1 || true

  local did=0
  if grep -q 'official:.*AVAILABLE' "$STATUS" 2>/dev/null; then
    echo "→ Installing the official build..."
    "$SCRIPT_DIR/install-official.sh" && did=1
    # install-official.sh replaces the whole prefix, so any custom UI in it is
    # gone. Put it back only if it was there before this ran.
    if [[ $did -eq 1 ]]; then
      echo "→ Re-applying custom UI to the official build..."
      "$SCRIPT_DIR/update-ui.sh" --official || true
    fi
  fi
  if grep -q 'patched:.*AVAILABLE' "$STATUS" 2>/dev/null; then
    echo "→ Updating the patched build..."
    "$SCRIPT_DIR/update-appimage.sh" && did=1
  fi

  # Always re-patch the daily driver if its sources moved, update or not.
  if patch_stale "$PATCHED_ASAR"; then
    echo "→ Re-applying custom UI to the patched build..."
    "$SCRIPT_DIR/update-ui.sh" && did=1
  fi

  [[ $did -eq 0 ]] && echo "Nothing to do - everything current."
  "$SCRIPT_DIR/check-updates.sh" >/dev/null 2>&1 || true
  return 0
}

case "${1:-status}" in
  status|"") cmd_status ;;
  json)      shift; cmd_json "$@" ;;
  page)      shift; cmd_page "$@" ;;
  patch)     shift; cmd_patch "$@" ;;
  update)    shift; cmd_update "$@" ;;
  share)     cmd_share ;;
  unshare)   cmd_unshare ;;
  quit)      cmd_quit ;;
  -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) echo "unknown command: $1 (try --help)" >&2; exit 1 ;;
esac
