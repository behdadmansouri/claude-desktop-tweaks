# Known Issues — Fixed

Full bug history with root causes. For the current state of features, see [TODO.md](../TODO.md).

---

## 1. `--remote-debugging-port` kills the app silently
**Version 1.9255.0** added a security check: if `--remote-debugging-port` is in argv without a valid
`CLAUDE_CDP_AUTH` token, the app calls `process.exit(1)` immediately. We had added this flag to
`launcher-common.sh` for CDP debugging. Removed it.

**File changed:** `~/.local/lib/claude-desktop-patched/usr/lib/claude-desktop/launcher-common.sh`

---

## 2. MutationObserver crash in custom-ui.js
`document.documentElement` was null when `bootstrap()` first ran (Electron renderer timing).
Fixed: added a 100ms retry loop.

---

## 3. Renderer hang after ~2 minutes
The `MutationObserver` was calling `scan()` directly on every DOM mutation. Claude.ai (React)
fires hundreds of mutations per second → renderer thread overwhelmed → detected as "unresponsive" → killed.

**Fix:** debounced the observer callback to coalesce mutations into one `scan()` call per 300ms.
Also slowed `setInterval` from 1200ms → 2000ms.

---

## 4. Workspace panel stacking/darkening
Multiple panel elements were accumulating in the DOM. Fixed with class-based cleanup.

---

## 5. Workspace click not selecting folder
Root cause: Radix UI requires full pointer-event sequence, not just `.click()`. Also `waitMenu()`
was finding stale menu items. Fixed with `fireClick()` + `waitNewMenu()`. v7 removed the global
fallback that was returning existing items.

---

## 6. Negative space after hiding topbar
- v6: patch `navigator.windowControlsOverlay.getTitlebarAreaRect()` → 0 height + `resize` event +
  base CSS reset
- v7: also add CSS `#dframe-main,.dframe-content{padding-top:0!important}`

See [architecture.md](architecture.md) for the full root cause.

---

## 7. Top bar returning after React re-render
JS-only `display:none` approach was vulnerable to React unmounting/remounting (fresh DOM node, no
inline style). Fixed: CSS rule `[data-top-left="true"]{display:none!important}` applies regardless
of when the element is created.

---

## 8. Usage badge colors
The number portion of badges (`42` in `C42%`) was rendered in white. Fixed by wrapping the entire
`${letter}${pct}%` string in the color span, not just the letter.

---

## 9. Reset time badges always empty
`scanForUsageExtras()` was only scanning `[role="dialog"]` etc. Reset time is also shown in visible
`.text-t6` / `.text-footnote` spans like `56% · resets 1h`. Added scanning of those elements. Also:
`parseUsage()` now extracts reset times from the usage button's `aria-label` if present.

---

## 10. Workspace panel always-on overlap with new-session overview
Panel was `position:absolute` with no trigger — always visible, floating on top of the page
overview. Two fixes: (a) panel hidden by default, shown only on `mouseenter` of the workspace row,
hidden on `mouseleave` of both row and panel with 150ms grace period; (b) background hardcoded to
`#f5f4ef` instead of `var(--bg-100)` which could inherit alpha.

---

## 11. Reset time badges (2h/3d) disappeared
`scanForUsageExtras()` only queried `[role="dialog"],[role="tooltip"]` etc. Radix popovers in
claude.ai render in `[data-radix-popper-content-wrapper]` and `[data-state="open"]` containers,
which weren't in the selector list. Broadened selector to include those.

---

## 12. All custom UI features dead after v2.1.181 upgrade (loader bug)

This was the critical v8 fix. The entire injection was dead — not a feature bug, a loader bug.

**Root cause:**
1. The loader's first statement was `var _fs=require('fs'),_hp=require('os')...` placed **outside**
   the inner try/catch. In the sandboxed preload, `require('fs')` throws immediately. The throw jumped
   to the outer `catch`, so `_inject()` / the `eval(_c)` never ran.
2. The loader used `eval(_c)` (preload isolated world) instead of `webFrame.executeJavaScript` (page
   main world).

**Fix:** Rewrote the loader template in `update-ui.sh` to:
- Drop `require('fs')`/`require('os')` entirely
- Inject via `require('electron').webFrame.executeJavaScript(_c)` (proven working — same as WCO shim)
- Guard everything so a failure can never silently kill the injection

See [architecture.md → Preload sandbox constraint](architecture.md#preload-sandbox-constraint).

---

## 13. Effort/reasoning picker auto-collapsed by usage popover refresh

`refreshUsagePopover()` used a global `Escape` / `body.click()` to close the usage popover.
This also closed whatever else was open (the effort picker). Fixed: snapshot `_lastUserInput`, only
toggle the usage button via its own `aria-expanded` if no new input arrived. No global Escape/body
click.

---

## 14. Chat number badges overlapping Claude's status dot

At `left:9px` the floating badge fully overlapped Claude's per-chat status dot (the working/ready
spinner at the row's left edge). Fixed: switched from absolutely-positioned chip to inline circled
glyph (①–⑨) prepended as the first child of the title button. Inline flow pushes the title right
instead of stacking on top.

---

## 15. Rate-limit red ring never clearing

**Root cause:** the "too many requests" error bubble stays in the transcript permanently, so
re-scanning body text can never clear it.

**Fix (v12):** Added `RATELIMIT_TTL = 1h`; `applyRings()` only draws red while `now - ts < TTL`.
The stored entry is KEPT after expiry so the persistent transcript text can't immediately re-flag.

**Fix (v13):** Added `clearRateLimitOnReply()` — detects when Claude starts generating a normal
reply and drops the ring immediately, recording it in `cc-ratelimit-cleared` so the lingering
transcript text can't re-flag it.

---

## 16. dframe sidebar — all selectors stale (v10)

**Root cause:** Claude shipped a completely new sidebar layout system. Chat rows are no longer
`<a href="/chat/ID">` anchors. All chat-ID-based features broke silently.

**Fix:** Full rewrite of sidebar helpers to use dframe row selectors. See [architecture.md →
dframe sidebar redesign](architecture.md#dframe-sidebar-redesign-2026-06-discovery--v10).

---

## 17. Blank/white page — Chromium GPU process crash (2026-07-05)

**Symptom:** app opens to a blank page, then the window dies.

**Root cause:** NOT our patch. The bundled Electron's GPU process failed:
`GPU process launch failed: error_code=1002` (repeated) → `FATAL … GPU process isn't usable. Goodbye.`
(seen in `~/.cache/claude-desktop-debian/launcher.log`). This is upstream issue #583. Manjaro is
rolling-release; a Mesa/driver/kernel update broke GPU init for the old bundled Electron even though
our patched app binary (2.1.149) was unchanged. Coincided with the app auto-updating in the
background (official versions now managed under `~/.local/share/claude/versions/`, newest 2.1.201).

**Fix:** added `CLAUDE_DISABLE_GPU=1` to the launcher env (the launcher's `launcher-common.sh`
honors it and appends `--disable-gpu --disable-software-rasterizer`). Applied to BOTH launch paths:
- `~/.local/share/applications/claude-desktop.desktop` (app-menu)
- `~/.config/autostart/claude-desktop.desktop` (login autostart)

Both `Exec=` lines now read `env CLAUDE_USE_WAYLAND=1 CLAUDE_DISABLE_GPU=1 …/AppRun`. Ran
`update-desktop-database ~/.local/share/applications`. Fixed the crash — app now runs stably with
software compositing. See also `memory/project_claude_desktop_gpu_crash.md`.

**Debugging note:** a GUI launch from a non-interactive Claude Code bash session dies immediately
(no Wayland seat / different session) — verification must be done by the user launching from the
menu, not by the agent launching in the background.

---

## 18. Blank page part 2 — top-bar hider blanked the new /epitaxy home UI (2026-07-05)

**Symptom (after #17's GPU fix):** page rendered for a split second, then went white and stayed white.

**Root cause:** OUR patch. Claude shipped a redesigned home at route `/epitaxy`. It reuses the
`data-top-left="true"` attribute — but that attribute now sits on a container that wraps the ENTIRE
app content, not the little title bar it marked before. Our top-bar hider therefore hid everything:
- CSS rule `[data-top-left="true"]{display:none!important;height:0!important;overflow:hidden!important}` (css.js)
- `hideTopBar()` → `findTopBar()` returns the `[data-top-left="true"]` element first and applies
  `display:none` + climbs parents (topbar.js)

**How it was diagnosed:** a temporary `ccDiag()` beacon in `bootstrap.js` logged DOM state to the
renderer log (`~/.config/Claude/logs/claude.ai-web.log`). Key signal: `bodyTextContentLen` grew to
~6000 (content present in DOM) while `innerText` length stayed 0 (nothing visible — everything
`display:none`), and `topLeft=1`. `innerText` returns "" for `display:none` subtrees; `textContent`
does not — that gap is what proved "rendered but hidden by us" vs "renderer never loaded".
`hideNewSessionOverview` was cleared as a suspect (`ovHidden=0`).

**Fix:** removed the `[data-top-left]` CSS rule (css.js) and early-`return`'d `hideTopBar()`
(topbar.js). Also early-`return`'d `hideNewSessionOverview()` (banners.js) — same class of risk on
the new non-`/chat/` route. Top-bar hiding is now OFF (native top bar visible again); it needs
reworking against the new DOM before re-enabling. Diagnostic beacon removed after confirmation.

**Lesson:** attribute-selector-based hiders that `display:none` a whole element are fragile across
Claude UI redesigns — when the attribute gets reused on a bigger container, the feature nukes the
app. Prefer size/position guards (never hide an element taller than ~80px or that contains the
composer/main) over blanket attribute matches.
