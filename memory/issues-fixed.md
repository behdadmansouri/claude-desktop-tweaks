# Known Issues - Fixed

Full bug history with root causes (#1-29). For the current state of features, see
[TODO.md](../TODO.md).

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
Panel was `position:absolute` with no trigger - always visible, floating on top of the page
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

This was the critical v8 fix. The entire injection was dead - not a feature bug, a loader bug.

**Root cause:**
1. The loader's first statement was `var _fs=require('fs'),_hp=require('os')...` placed **outside**
   the inner try/catch. In the sandboxed preload, `require('fs')` throws immediately. The throw jumped
   to the outer `catch`, so `_inject()` / the `eval(_c)` never ran.
2. The loader used `eval(_c)` (preload isolated world) instead of `webFrame.executeJavaScript` (page
   main world).

**Fix:** Rewrote the loader template in `update-ui.sh` to:
- Drop `require('fs')`/`require('os')` entirely
- Inject via `require('electron').webFrame.executeJavaScript(_c)` (proven working - same as WCO shim)
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

**Fix (v13):** Added `clearRateLimitOnReply()` - detects when Claude starts generating a normal
reply and drops the ring immediately, recording it in `cc-ratelimit-cleared` so the lingering
transcript text can't re-flag it.

---

## 16. dframe sidebar - all selectors stale (v10)

**Root cause:** Claude shipped a completely new sidebar layout system. Chat rows are no longer
`<a href="/chat/ID">` anchors. All chat-ID-based features broke silently.

**Fix:** Full rewrite of sidebar helpers to use dframe row selectors. See [architecture.md →
dframe sidebar redesign](architecture.md#dframe-sidebar-redesign-2026-06-discovery--v10).

---

## 17. Blank/white page - Chromium GPU process crash (2026-07-05)

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
`update-desktop-database ~/.local/share/applications`. Fixed the crash - app now runs stably with
software compositing. See also `memory/project_claude_desktop_gpu_crash.md`.

**Debugging note:** a GUI launch from a non-interactive Claude Code bash session dies immediately
(no Wayland seat / different session) - verification must be done by the user launching from the
menu, not by the agent launching in the background.

---

## 18. Blank page part 2 - top-bar hider blanked the new /epitaxy home UI (2026-07-05)

**Symptom (after #17's GPU fix):** page rendered for a split second, then went white and stayed white.

**Root cause:** OUR patch. Claude shipped a redesigned home at route `/epitaxy`. It reuses the
`data-top-left="true"` attribute - but that attribute now sits on a container that wraps the ENTIRE
app content, not the little title bar it marked before. Our top-bar hider therefore hid everything:
- CSS rule `[data-top-left="true"]{display:none!important;height:0!important;overflow:hidden!important}` (css.js)
- `hideTopBar()` → `findTopBar()` returns the `[data-top-left="true"]` element first and applies
  `display:none` + climbs parents (topbar.js)

**How it was diagnosed:** a temporary `ccDiag()` beacon in `bootstrap.js` logged DOM state to the
renderer log (`~/.config/Claude/logs/claude.ai-web.log`). Key signal: `bodyTextContentLen` grew to
~6000 (content present in DOM) while `innerText` length stayed 0 (nothing visible - everything
`display:none`), and `topLeft=1`. `innerText` returns "" for `display:none` subtrees; `textContent`
does not - that gap is what proved "rendered but hidden by us" vs "renderer never loaded".
`hideNewSessionOverview` was cleared as a suspect (`ovHidden=0`).

**Fix:** removed the `[data-top-left]` CSS rule (css.js) and early-`return`'d `hideTopBar()`
(topbar.js). Also early-`return`'d `hideNewSessionOverview()` (banners.js) - same class of risk on
the new non-`/chat/` route. Top-bar hiding is now OFF (native top bar visible again); it needs
reworking against the new DOM before re-enabling. Diagnostic beacon removed after confirmation.

**Lesson:** attribute-selector-based hiders that `display:none` a whole element are fragile across
Claude UI redesigns - when the attribute gets reused on a bigger container, the feature nukes the
app. Prefer size/position guards (never hide an element taller than ~80px or that contains the
composer/main) over blanket attribute matches.

---

## 19. "emoji only" mode collapsed the panel into one tall column (2026-08-09)

**Symptom:** ticking "emoji only" didn't strip project names - it just stacked everything into a
single column, which then made the panel tall enough to run off the top of the window.

**Root cause:** `makeFolderBtn` derived compactness itself: `compact = emojiOnly() && emoji`. A
folder with no leading emoji (`AI Projects`, `memory`, `temp`, and every SSH folder - server paths
have no emoji convention) therefore still rendered a named row at `width:100%`, and a 100%-wide
item inside the emoji-only `display:flex;flex-wrap:wrap` grid forces a line break. One non-emoji
folder per line is exactly what the user saw.

**Fix:** compactness is now decided by the caller and passed down (`folderGrid(..., {compact})` →
`makeFolderBtn(..., opts)`). The Local column opts in and *filters out* emoji-less folders rather
than rendering them wide; the Remote column never compacts, so SSH folders keep readable names in
both modes. If filtering would empty the Local column, it falls back to the full list.

**Lesson:** a "compact" flag read from global state inside a leaf renderer can't be overridden by
the one caller that needs the other behaviour. Pass presentation down from the container.

---

## 20. Panel escaped the viewport on zoom and with long lists (2026-08-09)

**Symptom:** the project selector hung off the edge of the window, and browser zoom made it worse.

**Root cause:** two halves.
- Horizontal: `clampPanel` ran only at install and rebuild. Zoom changes `window.innerWidth` and
  moves the row, but nothing re-ran the clamp, so the manually-computed `left` offset went stale.
- Vertical: the panel is anchored `bottom:calc(100% + 6px)` (it grows *upward*) but capped with a
  fixed `max-height:calc(100vh - 90px)`, which ignores how far the workspace row actually sits from
  the top of the window. Available space above the row is `row.top`, not the viewport height.

**Fix:** `clampPanel` now sets `max-height` per call from the row's live `getBoundingClientRect().top`
(min 140px) and keeps the horizontal shift; `scheduleClamp()` (one rAF-coalesced clamp of every
panel) is wired to `window.resize`, `visualViewport` resize/scroll, and a per-panel `ResizeObserver`
so content changes re-clamp too. The observer is disconnected in `removeAllPanels`. The TODO preview
body also went from `height:min(240px,28vh)` to `max-height:` so short TODOs stop reserving 240px.

**Lesson:** for an upward-growing absolutely-positioned box, `100vh` is never the right budget -
measure the anchor.

---

## 21. Stray SSH entries that mixed up Local and remote (2026-08-09)

**Symptom:** unreadable tiles in the SSH column; clicking them got "confused between local and ssh".

**Root cause:** the row click handler sampled the connection label and the folder label exactly
400ms after *any* click on the workspace row. Switching workspace is two async steps (connection,
then folder), so a single fixed-delay sample can catch the new SSH host still paired with the
previous Local folder. That bogus pair persisted in `cc-ws-v4` forever, and clicking it later sent
`clickWorkspace` hunting for a Local folder on the SSH host. Labels were also stored raw from
`textContent`, so control/private-use codepoints (icon fonts) came along and rendered as tofu.

**Fix:** `sampleWS()` takes two samples ~700ms apart and only records when they agree and no menu
is open; `cleanLabel()` strips `\p{Cc}\p{Cf}\p{Co}` and collapses whitespace, and `recordWS`
dedupes case-insensitively on the cleaned value. Right-clicking a remote tile calls `forgetWS()` to
drop a bad entry (remote tiles only - Local tiles come from `cc-folders.json`, so forgetting one
wouldn't remove it). Real SSH folders live under `/root/000_myagents/...`, confirmed in
`~/.config/Claude/claude_desktop_config.json` (`epitaxyPrefs/epitaxy-folder-permission-mode.*`).

**Lesson:** scraping UI labels on a timer records transitional states. Sample twice and require
agreement, or don't record at all.

---

## 22. Panel jittered under the cursor while hovering projects (2026-08-18)

**Symptom:** "the project selector changes its height based on the height of the to do file, and
it causes jitter when I'm hovering over the different projects. And sometimes I can't select the
one I want."

**Root cause:** geometry, not the preview. The panel was one absolutely-positioned box anchored
`bottom:calc(100% + 6px)` with content-derived height, and the TODO preview sat *below* the
project rows inside it. Bottom-anchored + taller content = the top edge moves up, so the project
rows move up too. That slides a different project under a stationary cursor, which swaps the
preview, which resizes the panel again. A hover feedback loop, and the reason a click sometimes
landed on the neighbouring project.

**Fix:** the panel is now a fixed-size box (width and height computed from the viewport in
`clampPanel`, never from content) split into two independently-scrolling panes - project list
left, TODO preview right. Hovering repaints the preview pane and moves nothing. Under ~470px of
width the panes stack instead of the preview being dropped, and both dimensions stay fixed.
`prev.scrollTop = 0` on each preview swap, since the pane otherwise keeps the previous project's
scroll offset.

**Lesson:** if hovering a list moves the list, the bug is in the box, not in what fills it.

---

## 23. "emoji only" mode did nothing at all (2026-08-18)

**Symptom:** ticking the checkbox had no visible effect.

**Root cause:** `splitEmoji()` only matched a **leading** emoji
(`/^([^\p{L}\p{N}]+)([\p{L}\p{N}].*)$/su`), but this workspace's folder-naming convention puts it
at the **end** ("Claude Desktop 🤖", "Product Hunt 🛒" - see `memory/reference_folder_naming.md`
in the root workspace). So every folder came back `{emoji:''}`, `buildColumn`'s
`folders.some(f => …emoji)` guard was always false, `compact` never turned on, and the toggle
flipped a flag nothing read. Issue #19 fixed the *layout* of emoji-only mode without noticing the
detector had never matched a single real folder.

**Fix:** `splitEmoji()` checks the suffix first, then the prefix. The candidate run must contain a
`\p{Extended_Pictographic}` character, so a folder named `v1.` doesn't get its trailing period
eaten as an emoji.

**Lesson:** a guard clause that silently disables a feature when its detector returns nothing
looks identical to the feature being off. Test the detector against the real data, not against
the example in the comment.

---

## 24. Panel cropped to a useless sliver at browser zoom (2026-08-18)

**Symptom:** "when I zoom the project selector gets cropped, and I can't do everything in it. And
it becomes useless."

**Root cause:** #20's fix. Capping `max-height` to the space above the workspace row is correct
while there *is* space above the row, but browser zoom shrinks the viewport in CSS pixels, so that
space collapses toward zero and the clamp faithfully squeezed the panel into a scrolling sliver.

**Fix:** `clampPanel` now has two modes. With >= 210px of headroom it anchors above the row as
before. Below that it stops respecting the row entirely and anchors to the viewport (top margin,
up to `100vh - 24px`), accepting that it overlaps the row. A collapse chevron in the panel header
(persisted in `cc-ws-collapsed`) is the way to get it out of the way. The panel is also
`position:fixed` on `<body>` now rather than absolute inside the row - a single `transform` on any
ancestor would otherwise redefine its containing block.

**Lesson:** "clamp to the available space" and "the available space is about to be zero" need
different answers. Pick a floor and change strategy under it.

---

## 25. Usage numbers could never be live (2026-08-18 rewrite)

**Symptom:** the reason the original usage badges were disabled and then deleted. Percentages went
stale, reset-time badges kept breaking as the wording changed (#9, #11), and the attempt to keep
them fresh by re-opening the usage popover on a timer closed whatever else was open (#13).

**Root cause:** the data source. 5-hour and weekly figures only exist in the DOM while the usage
popover is open, so anything reading the DOM is reading a snapshot of the last time the user
happened to open it. No amount of better selectors fixes that.

**Fix:** stop reading the DOM. `usage.js` calls the same endpoint the app's own tray usage menu
calls - `GET /api/organizations/<org>/usage`, documented in
[architecture.md](architecture.md#plan-usage-endpoint-2026-08-18-discovery) - on a 60s timer, on
window focus, and 5s/25s after any `/completion` request (the only moment usage actually changes).
It also adopts any `/usage` response the app fetches for itself, via a `window.fetch` wrapper, so
the numbers move the instant the app's own refresh lands. `resets_at` is an ISO timestamp, so the
reset-time pattern matching that broke twice is gone from the live path entirely;
`parseResetText()` survives only as a fallback for scraped text and now covers ISO, epoch,
relative ("in 2h 15m", "resets 59m"), weekday+clock, month+day, numeric dates and bare clock times.

**Still unsolved:** the context window figure has no endpoint. It stays DOM-sourced and shows
`--` when nothing exposes it.

**Lesson:** when a value is only in the DOM while a transient popover is open, the popover is not
the data source, and no scraping strategy will make it one.

---

## 26. Local column painted into the SSH column (2026-08-18)

**Symptom:** "you overlap the local projects with my SSH projects." Not sometimes - always.

**Root cause:** `folderGrid` used `grid-template-columns:1fr 1fr`. A grid item defaults to
`min-width:auto`, so it refuses to shrink below its content width and overflows its track rather
than ellipsising. The column box was 215px; items rendered 96px past its right edge, straight over
the Remote column.

**Fix:** `minmax(0,1fr)`. Measured on the real 25-folder list: 14 rows spilled before, 0 after.

**Lesson:** `1fr` does not mean "at most half". Any grid or flex track holding text that must
ellipsise needs `minmax(0,1fr)` or `min-width:0`.

---

## 27. Emoji-only tiles had a 6px hit box (2026-08-18)

**Symptom:** "when it's on emoji only, the emojis overlap. Like, the line height is extremely low,
and I can't hover or select any of them."

**Root cause:** `EMOJI_CSS` sets `line-height:0`, deliberately, so an oversized emoji doesn't grow
a *named* row. In a compact tile the emoji span is the button's only child, so the button's
content height collapsed to zero and the whole tile measured 38x6px while painting a 21px glyph.
Rows sat 7px apart, so consecutive glyphs drew over each other and the clickable slivers were too
thin to hit. #19 and #23 both touched emoji-only mode without measuring a rendered tile.

**Fix:** compact tiles get an explicit 30x30 box and `line-height:1` (`TILE_CSS`), independent of
`EMOJI_CSS`. Verified: 25 tiles, all 30x30, 0 overlapping pairs.

**Lesson:** `line-height:0` on the only child of a flex button collapses the button. The trick is
safe only where a sibling sets the height.

---

## 28. Unreadable tofu tiles at the bottom of the SSH list (2026-08-18)

**Symptom:** reported again after #21 supposedly fixed it.

**Root cause:** #21 sanitized on **write**. Entries already in `cc-ws-v4` from before that fix were
never touched, and one of them was labelled with nothing but zero-width spaces - which cannot be
clicked *or* right-clicked, so "right-click to forget" could never remove it either.

**Fix:** `loadWS()` cleans on read, drops any entry with no `\p{L}\p{N}` left, and rewrites the
store once so it stays clean.

**Lesson:** a validation fix that only runs on write leaves every existing row broken forever.
Sanitize on read, or migrate explicitly.

---

## 29. Anything in the top bar is unclickable, including the usage chip (2026-08-18)

**Symptom:** "when the remaining time thing is going to the top bar, I can't select it either" -
and the same complaint about the app's own top-bar icons.

**Root cause:** not the chip, and not a z-index problem. Electron marks the window's top strip as
a **drag region** (`-webkit-app-region: drag`) so the frameless window can be moved. A drag region
consumes pointer events before anything painted inside it receives them.

**Fix:** `-webkit-app-region: no-drag` on the usage chip, plus a 46px top offset so the top corners
clear the bar rather than sitting under the window controls.

**Lesson:** "it renders but won't take clicks, only near the top of the window" is a drag region,
every time. Nothing about stacking order will fix it.
