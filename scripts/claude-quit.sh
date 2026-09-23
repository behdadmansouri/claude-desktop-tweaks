#!/usr/bin/env bash
# Kill Claude Desktop (both the patched and official builds) and all child processes cleanly
PATTERN="claude-desktop-patched|claude-desktop-official"
PIDS=$(pgrep -f "$PATTERN" 2>/dev/null)
if [ -z "$PIDS" ]; then
  echo "Claude Desktop is not running."
  exit 0
fi
echo "Stopping Claude Desktop (PIDs: $PIDS)..."
pkill -TERM -f "$PATTERN" 2>/dev/null
sleep 1.5
pkill -KILL -f "$PATTERN" 2>/dev/null
pkill -KILL -f "cowork-vm-service" 2>/dev/null
echo "Done."
