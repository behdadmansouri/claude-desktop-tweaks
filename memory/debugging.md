# Debugging Reference

## Console markers

```js
"[custom-ui] ok"        // injection succeeded
"[custom-ui] <error>"   // genuine custom-ui.js error
```

## Log files

```
~/.config/Claude/logs/main.log              -- main process log
~/.config/Claude/logs/main-window.log       -- preload/renderer log
~/.config/Claude/logs/claude.ai-web.log     -- React errors
~/.cache/claude-desktop-debian/launcher.log -- shell launcher log
```

## Persisted state (localStorage)

```js
JSON.parse(localStorage.getItem('cc-reset-v1'))   // reset times {hourly: ms, weekly: ms}
JSON.parse(localStorage.getItem('cc-cache-v4'))   // warm-cache chat titles + timestamps
JSON.parse(localStorage.getItem('cc-ratelimit'))  // rate-limited chat titles
JSON.parse(localStorage.getItem('cc-ring-diag'))  // one-time cache/ratelimit ring scan results
JSON.parse(localStorage.getItem('cc-ws-debug'))   // last workspace folder click attempt
localStorage.getItem('cc-debug')                  // topbar detection strategy
```

## Clearing UI state

```js
// Re-enable the new-session overview
localStorage.setItem('ccShowOverview', '1'); location.reload();

// Clear rate-limit red rings
localStorage.removeItem('cc-ratelimit'); location.reload();

// Clear all cache tracking
localStorage.removeItem('cc-cache-v4'); location.reload();
```

## Constraints

| Constraint | Reason | Workaround |
|-----------|--------|-----------|
| Preload sandboxed | Electron security model | Embed data at patch time (folders, config) |
| No `require('fs')` in preload | Renderer isolation | `cc-ai-data` ipcMain handler reads live; baked `CC_AI_LOCAL`/`CC_AI_TODOS` as fallback |
| No CDP debugging | Security check in v1.9255.0+ | Use `update-ui.sh` + restart to test changes |
| Workspace click via pointer | Radix UI checks `isTrusted` | Keyboard nav fallback (Home → ArrowDown → Enter) |
| No preload hot-reload | Electron design | Must fully quit and restart app |
