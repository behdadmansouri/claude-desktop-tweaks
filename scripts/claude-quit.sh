#!/usr/bin/env bash
# Kill Claude Desktop and all its child processes cleanly
PIDS=$(pgrep -f "claude-desktop-patched" 2>/dev/null)
if [ -z "$PIDS" ]; then
  echo "Claude Desktop is not running."
  exit 0
fi
echo "Stopping Claude Desktop (PIDs: $PIDS)..."
pkill -TERM -f "claude-desktop-patched" 2>/dev/null
sleep 1.5
pkill -KILL -f "claude-desktop-patched" 2>/dev/null
pkill -KILL -f "cowork-vm-service" 2>/dev/null
echo "Done."
