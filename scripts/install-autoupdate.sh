#!/usr/bin/env bash
# Install (or remove) the systemd --user timer that keeps both Claude Desktop
# builds updated and re-patched.
#
# SCOPE: this laptop only. These are systemd --user units under
# ~/.config/systemd/user, not anything the repo carries to another host.
#
# THE ONE RULE: never act mid-session.
#
# `claude-ctl update` refuses while either build is running, and this timer
# never passes --force. So the sequence is always: you quit the app -> the next
# tick notices -> it updates and re-patches -> your next launch is current. An
# app update rewrites the asar that a running Electron process has mmapped;
# doing that live risks a half-read bundle, and would throw away whatever
# session you were in.
#
# That means the timer can tick for days doing nothing, which is correct and
# why it is cheap: the running-check is a pgrep, and the network check is
# skipped entirely when the app is up.
#
#   install-autoupdate.sh            install and start
#   install-autoupdate.sh --remove   stop, disable, delete
#   install-autoupdate.sh --status   is it on, when did it last run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
SERVICE="claude-desktop-autoupdate.service"
TIMER="claude-desktop-autoupdate.timer"

case "${1:-install}" in
  --status)
    systemctl --user status "$TIMER" --no-pager 2>/dev/null || echo "not installed"
    echo
    systemctl --user list-timers "$TIMER" --no-pager 2>/dev/null || true
    echo
    echo "--- last run ---"
    journalctl --user -u "$SERVICE" -n 25 --no-pager 2>/dev/null || echo "(no journal entries)"
    exit 0 ;;
  --remove)
    systemctl --user disable --now "$TIMER" 2>/dev/null || true
    rm -f "$UNIT_DIR/$SERVICE" "$UNIT_DIR/$TIMER"
    systemctl --user daemon-reload
    echo "Removed $TIMER and $SERVICE."
    exit 0 ;;
  install|"") ;;
  *) echo "usage: $0 [--remove|--status]" >&2; exit 1 ;;
esac

mkdir -p "$UNIT_DIR"

cat > "$UNIT_DIR/$SERVICE" <<EOF
[Unit]
Description=Update and re-patch Claude Desktop (skips while it is running)
# Pointless without a network, and the whole job starts with two HTTP requests.
After=network-online.target

[Service]
Type=oneshot
# Exit 3 is claude-ctl's "the app is running, not touching it" - the normal
# outcome most of the time, and not a failure worth a red unit or an alert.
SuccessExitStatus=0 3
# QUOTED: this project lives under "Documents/AI Projects/Claude Desktop 🤖".
# systemd splits ExecStart on whitespace, so an unquoted path here fails with
# 203/EXEC trying to run "/home/z3z0/Documents/AI".
ExecStart="$SCRIPT_DIR/claude-ctl.sh" update
# Regenerate the dashboard afterwards so the page is never staler than the last
# tick. Leading - so a rendering problem cannot fail the update itself.
ExecStartPost=-"$SCRIPT_DIR/claude-ctl.sh" page
# Long enough for a ~170MB .deb on a slow line, short enough to not wedge.
TimeoutStartSec=30min
Nice=10
IOSchedulingClass=idle
EOF

cat > "$UNIT_DIR/$TIMER" <<EOF
[Unit]
Description=Periodic Claude Desktop update check

[Timer]
# Every two hours, on an ABSOLUTE schedule.
#
# The first version used OnStartupSec + OnUnitActiveSec and scheduled nothing at
# all - `list-timers` showed NEXT as "-". OnUnitActiveSec only arms itself once
# the service has run, so with a startup trigger that had long since elapsed
# there was no first run to bootstrap from. OnCalendar always has a next
# occurrence, whenever it is enabled.
#
# The app is usually up, so most ticks cost a single pgrep and exit; the cadence
# is about catching the window after you quit, not about polling upstream often.
OnCalendar=*-*-* 00/2:17:00
# Do not stack missed runs from a suspended laptop into a burst on resume.
AccuracySec=5min
Persistent=false

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$TIMER"

echo "Installed and started $TIMER."
echo
systemctl --user list-timers "$TIMER" --no-pager || true
echo
echo "It will NOT update while Claude Desktop is running - that is by design."
echo "  status:  $SCRIPT_DIR/install-autoupdate.sh --status"
echo "  remove:  $SCRIPT_DIR/install-autoupdate.sh --remove"
echo "  now:     systemctl --user start $SERVICE"
