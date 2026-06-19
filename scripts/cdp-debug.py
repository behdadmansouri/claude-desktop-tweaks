#!/usr/bin/env python3
"""
CDP debug helper — connects to the running Claude Desktop app (port 9222)
and lets you eval JS, get element attributes, or run custom-ui.js live.

Usage:
  python3 cdp-debug.py eval "document.title"
  python3 cdp-debug.py eval-file custom-ui.js
  python3 cdp-debug.py elements "button[aria-label^='Usage:']"
  python3 cdp-debug.py screenshot  -> saves /tmp/claude-screenshot.png
  python3 cdp-debug.py pages        -> list all targets
"""
import sys, json, time, urllib.request, socket
import threading

CDP_HOST = 'localhost'
CDP_PORT = 9222

def cdp_targets():
    with urllib.request.urlopen(f'http://{CDP_HOST}:{CDP_PORT}/json') as r:
        return json.loads(r.read())

def find_main_page():
    targets = cdp_targets()
    # Prefer the main claude.ai page
    for t in targets:
        if 'claude.ai' in t.get('url','') and t.get('type') == 'page':
            return t
    # fallback: first page type
    for t in targets:
        if t.get('type') == 'page':
            return t
    return targets[0] if targets else None

class CDPSession:
    def __init__(self, ws_url):
        import websocket  # pip install websocket-client
        self._id = 0
        self._pending = {}
        self._lock = threading.Lock()
        self.ws = websocket.create_connection(ws_url, timeout=10)
        self._recv_thread = threading.Thread(target=self._recv_loop, daemon=True)
        self._recv_thread.start()

    def _recv_loop(self):
        while True:
            try:
                msg = json.loads(self.ws.recv())
                if 'id' in msg:
                    with self._lock:
                        ev = self._pending.pop(msg['id'], None)
                    if ev:
                        ev['result'] = msg
                        ev['done'].set()
            except Exception:
                break

    def send(self, method, params=None, timeout=8):
        self._id += 1
        mid = self._id
        ev = {'done': threading.Event(), 'result': None}
        with self._lock:
            self._pending[mid] = ev
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
        if not ev['done'].wait(timeout):
            raise TimeoutError(f'CDP timeout on {method}')
        return ev['result']

    def eval(self, expr, await_promise=False):
        r = self.send('Runtime.evaluate', {
            'expression': expr,
            'returnByValue': True,
            'awaitPromise': await_promise,
        })
        if 'error' in r:
            raise RuntimeError(r['error'])
        res = r.get('result', {}).get('result', {})
        if res.get('type') == 'undefined':
            return None
        return res.get('value', res.get('description', res))


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'pages'

    if cmd == 'pages':
        for t in cdp_targets():
            print(f"  [{t['type']}] {t.get('title','?')} — {t.get('url','?')[:80]}")
        return

    target = find_main_page()
    if not target:
        print('ERROR: no Claude Desktop page found on port 9222')
        print('Is Claude Desktop running? Does it have --remote-debugging-port=9222?')
        sys.exit(1)

    try:
        session = CDPSession(target['webSocketDebuggerUrl'])
    except Exception as e:
        print(f'Could not connect (websocket-client installed? pip install websocket-client): {e}')
        sys.exit(1)

    if cmd == 'eval':
        expr = ' '.join(sys.argv[2:])
        result = session.eval(expr)
        print(json.dumps(result, indent=2, default=str))

    elif cmd == 'eval-file':
        path = sys.argv[2]
        with open(path) as f:
            code = f.read()
        result = session.eval(code)
        print('Done:', result)

    elif cmd == 'elements':
        sel = sys.argv[2]
        result = session.eval(f'''
            (function() {{
                var els = document.querySelectorAll({json.dumps(sel)});
                return Array.from(els).slice(0,10).map(function(el) {{
                    return {{
                        tag: el.tagName,
                        id: el.id,
                        className: el.className.slice(0,100),
                        text: (el.textContent||'').trim().slice(0,80),
                        ariaLabel: el.getAttribute('aria-label')
                    }};
                }});
            }})()
        ''')
        print(json.dumps(result, indent=2))

    elif cmd == 'screenshot':
        r = session.send('Page.captureScreenshot', {'format': 'png'})
        import base64
        data = base64.b64decode(r['result']['data'])
        out = '/tmp/claude-screenshot.png'
        with open(out, 'wb') as f:
            f.write(data)
        print(f'Saved to {out}')

    elif cmd == 'console-logs':
        # Enable Console domain and listen for a few seconds
        session.send('Console.enable')
        print('Listening for console messages (5s)...')
        time.sleep(5)

    else:
        print(__doc__)

if __name__ == '__main__':
    main()
