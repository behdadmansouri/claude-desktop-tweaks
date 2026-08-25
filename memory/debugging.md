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
JSON.parse(localStorage.getItem('cc-ws-v4'))      // recorded conn/folder workspace pairs
JSON.parse(localStorage.getItem('cc-ws-debug'))   // last workspace folder click attempt
localStorage.getItem('cc-ws-emoji-only')          // '1' = emoji-only project tiles
localStorage.getItem('cc-ws-collapsed')           // '1' = project panel collapsed to its header
JSON.parse(localStorage.getItem('cc-usage-snap')) // last /usage payload {plan, at}
localStorage.getItem('cc-usage-org')              // cached organization uuid
localStorage.getItem('cc-usage-corner')           // br|bl|tr|tl - where the usage chip sits
localStorage.getItem('cc-usage-probe')            // '1' = log candidate usage payloads
localStorage.getItem('cc-hide-limit-nag')         // '0' = stop dismissing "approaching your limit"
localStorage.getItem('cc-diag')                   // '0' = stop the automatic [cc-dump] beacon
localStorage.getItem('cc-hide-topbar')            // '0' = keep the in-app top bar
```

Keys from the deleted features (`cc-reset-v1`, `cc-cache-v4`, `cc-ratelimit`, `cc-ring-diag`,
`cc-debug`) may still be sitting in localStorage; nothing reads them since the 2026-07-12 trim.

## Debug hooks (DevTools console)

```js
window.__ccUsage()          // {org, plan, planAgeMs, ctx, failures, corner, refresh(), probe(bool)}
window.__ccUsage().refresh()// force a /usage poll now
window.__ccTitleDebug()     // which titlewatch strategy is winning
window.__ccDump()           // one-line DOM survey; also auto-runs 6s after load
window.__ccTopbar.show()    // put the in-app top bar back
window.__ccTopbar.candidate()// what the top-bar hider would match right now
```

`__ccDump()` writes to `console.error`, so it lands in `claude.ai-web.log`. Read it back with:

```bash
grep -o '\[cc-dump\] .*' ~/.config/Claude/logs/claude.ai-web.log | tail -1
```

This is the only live-DOM channel out of the app - CDP is still gated behind a signed
`CLAUDE_CDP_AUTH` token (#1), so `scripts/cdp.py` cannot attach.

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

## Panel + chip state (2026-08-21)

localStorage keys the panel reads:

| Key | Values | Meaning |
|---|---|---|
| `cc-ws-name-mode` | `emoji` \| `short` \| `full` | How much of each project name to show. Falls back to the old `cc-ws-emoji-only` = `'1'` once, for migration, then defaults to `short` |
| `cc-ws-collapsed` | `'1'` / `'0'` | Panel collapsed to its header row |
| `cc-ws-v4` | JSON array | Recorded `{conn, folder, ts}` - the **only** source of the Remote column, written only by `sampleWS()` |
| `cc-ws-debug` | JSON | Last menu-navigation attempt. Also echoed to the renderer log as `[cc-ws-debug]` |
| `cc-usage-corner` | `br`/`bl`/`tr`/`tl` | Where the floating usage chip sits (right-click the chip to cycle) |

Runtime state that is deliberately **not** persisted: the TODO preview pin (`_pinFolder`/`_pinHost`)
and the selected file (`_prevFile`). A pin that survived a restart would be a mystery the next time
the panel came up showing a project you don't remember choosing.

`window.__ccUsage()` now also reports `ctxStale`, `floating` (fallback corner mode vs inlined in the
composer footer) and `armed` (whether the floating chip is currently accepting clicks). If the chip
appears to ignore clicks, check `floating: true, armed: false` - that is correct behaviour, it arms
after the pointer rests on it for 200ms.

## Update status

`scripts/check-updates.sh --report` prints the last check instantly and offline; without arguments
it re-checks and rewrites `~/.cache/claude-desktop-tweaks/update-status`. A SessionStart hook does
both (report, then refresh in the background). It never installs anything - the install paths need
sudo or ~170 MB, and neither belongs in a hook that runs unattended.
