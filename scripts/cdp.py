#!/usr/bin/env python3
"""
Live DOM introspection for the running Claude Desktop app via Chrome DevTools
Protocol. Replaces the old cdp-debug.py that was dropped in the June cleanup.

The renderer is the only place the desktop-only chrome exists (top bar, the
Local/SSH connection selector, ccBridge), so reading claude.ai in a normal
browser tells us nothing about it. This talks to the real app instead.

Requires the app to be launched with a debug port:

    ~/.local/bin/claude-quit
    CLAUDE_USE_WAYLAND=1 ~/.local/lib/claude-desktop-patched/AppRun \
        --remote-debugging-port=9222

Usage:
    ./scripts/cdp.py targets                 # list debuggable pages
    ./scripts/cdp.py eval '<js expression>'  # run JS, print JSON result
    ./scripts/cdp.py eval -f probe.js        # run JS from a file
"""
import argparse
import json
import sys
import urllib.request

import websocket  # websocket-client

PORT = 9222


def http_json(path):
    url = f"http://127.0.0.1:{PORT}{path}"
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return json.load(r)
    except Exception as e:
        sys.exit(
            f"ERROR: cannot reach CDP on port {PORT} ({e}).\n"
            "Is Claude Desktop running with --remote-debugging-port=9222?"
        )


def pick_target():
    """The main claude.ai renderer, not devtools/service-worker targets."""
    pages = [
        t for t in http_json("/json/list")
        if t.get("type") == "page" and "devtools://" not in t.get("url", "")
    ]
    if not pages:
        sys.exit("ERROR: no debuggable page targets found.")
    # Prefer a claude.ai document over about:blank / helper windows.
    for t in pages:
        if "claude.ai" in t.get("url", ""):
            return t
    return pages[0]


def evaluate(expr):
    target = pick_target()
    ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=30)
    try:
        ws.send(json.dumps({
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expr,
                "returnByValue": True,
                "awaitPromise": True,
            },
        }))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 1:
                break
    finally:
        ws.close()

    if "error" in msg:
        sys.exit(f"CDP error: {msg['error']}")
    result = msg.get("result", {})
    if "exceptionDetails" in result:
        det = result["exceptionDetails"]
        desc = det.get("exception", {}).get("description") or det.get("text")
        sys.exit(f"JS exception: {desc}")
    return result.get("result", {}).get("value")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("targets")
    ev = sub.add_parser("eval")
    ev.add_argument("expr", nargs="?")
    ev.add_argument("-f", "--file", help="read the JS expression from a file")
    args = ap.parse_args()

    if args.cmd == "targets":
        for t in http_json("/json/list"):
            print(f"{t.get('type'):16} {t.get('title','')[:40]:42} {t.get('url','')[:70]}")
        return

    if args.file:
        with open(args.file) as f:
            expr = f.read()
    elif args.expr:
        expr = args.expr
    else:
        expr = sys.stdin.read()

    print(json.dumps(evaluate(expr), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
