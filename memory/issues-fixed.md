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
at the **end** ("Claude Desktop 🤖", "Product Hunt 🛒" - see `memory/reference/reference_folder_naming.md`
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

---

## 30. The project panel sat on top of the app's own dialogs (2026-08-21)

**Symptom:** "I can't manually select a project when opening the menu that Claude has itself, or
when I bring up the settings - the project picker is on top of the settings."

**Root cause:** the panel is `position:fixed` at `z-index:2147482000`. That number is not one you
can lose to, which is the point when it has to sit over the composer - and exactly wrong when the
app opens a modal. There is no single z-index that is correct for both cases.

**Fix:** stop treating it as a stacking question. `applyPanelVisibility()` (called from the scan
loop) hides the panel whenever a real app overlay is open - matched by role/attribute
(`[role=dialog]`, `[role=menu]`, `[role=listbox]`, the Radix popper/select/dropdown wrappers) with a
60x24 size floor, and with tooltips explicitly excluded so the panel doesn't blink out every time
the pointer grazes a toolbar icon. `visibility:hidden`, not `display:none`, so the next
`clampPanel()` doesn't measure a collapsed box.

**Lesson:** an overlay that must outrank the app's content will also outrank the app's modals. The
answer is to yield, not to pick a bigger number.

---

## 31. Picking a project opened a different project (2026-08-21)

**Symptom:** "when I select the Pebble project, it opens Time Management for me."

**Root cause:** `waitNewMenu()`'s scraper matched on `_ITEM_SEL`, which lists both `li` and
`button`. A menu row built as `<li><button>Pebble</button></li>` therefore produced **two** entries,
and the old filter (drop anything containing a `[role=menuitem]`) missed it because a plain button
carries no role. So an N-row menu could scrape as a 2N-item list - and the keyboard fallback
navigated by **index**: it counted `indexOf(target)` phantom rows, pressed ArrowDown that many
times, and committed whatever happened to be highlighted when it stopped. Nothing about the name
matching was wrong.

**Fix:** two layers.
1. `grab()` now keeps only innermost matches (`raw.filter(el => !raw.some(o => o !== el && el.contains(o)))`).
2. `keyboardPick()` replaces blind arrow-counting: it walks down one row at a time and checks what
   is *actually* highlighted after each step, pressing Enter only when that is the target. If it
   never lands on it, it presses nothing. The old "Enter didn't commit, so click whatever is
   highlighted" fallback is gone - it clicks the target or nothing.

**Lesson:** navigating a menu by index is a guess about someone else's DOM. Verify the highlight
before committing; "nothing happened" is a recoverable outcome, "opened the wrong project" is not.

---

## 32. Switching to a remote host did nothing (2026-08-21)

**Symptom:** "it opens the remote selector, the host selector, and it can't select the other host."

**Root cause:** after switching connection, the code looked for a dialog and only handled
`opts.length === 1` - literally `else return`. With more than one host configured it opened the
picker and abandoned it. Separately, the connection menu was matched with a first-hit substring
test, so an action row like "Manage <host>…" could win over the host itself.

**Fix:** the host dialog is now scored with the same `bestMatch()` used for folders, over
innermost-deduped options with action labels (`cancel/close/back/add/new/manage/help`) filtered out,
followed by a confirm button if the build wants one. The connection menu excludes rows starting
with add/set up/manage/configure/connect to/new before scoring. Both log a `[cc-ws-debug]` line.

Also: the remote folder browser now **walks the path** one segment at a time - find the earliest
remaining segment listed here, click it, re-read the listing, repeat - instead of only looking for
the final basename in whatever directory the dialog happened to open. Exact text matches only, no
blind "Go" and no Enter; a segment that isn't listed stops the walk and leaves the dialog open.

---

## 33. sampleWS() was called but did not exist (2026-08-21)

**Symptom:** none visible, which is the interesting part. Found while auditing, not from a report.

**Root cause:** the 2026-07-12 scope trim deleted `sampleWS()` but left its call site in
`installPanel()` (`wsRow.addEventListener('click', () => sampleWS(wsRow), true)`). Every click on
the workspace row threw a ReferenceError out of a capture-phase listener - harmless to the app, but
`sampleWS` was the **only writer of `cc-ws-v4`**, and `cc-ws-v4` is the entire source of the panel's
Remote column. So no remote folder had been recorded since July; the Remote column has been showing
a frozen snapshot from before the trim.

**Fix:** reinstated, deferred 900ms (the click is captured on the way *down*, when the row still
shows the previous selection), with placeholder labels ("Open folder…", "Select…") rejected.

**Lesson:** when trimming dead code, grep for the callers too. A missing function inside an event
listener fails silently and takes a whole data path with it.

---

## 34. Context and the 5-hour limit showed the same number (2026-08-21)

**Symptom:** "on the new session page, the usage tracker shows the same number for the 5-hour limit
as the context, and that is incorrect."

**Root cause:** `cuScanContext()` sliced the popover text from the word "context" **to the end** and
took the first percentage anywhere after it. On a page whose popover has a "Context window" heading
with no number of its own - a fresh session, nothing sent yet - the first `%` it found belonged to
the next row, i.e. the 5-hour limit. The reading was also never expired, so a number scraped in one
conversation was presented as the next one's.

**Fix:** three parts.
1. `cuCtxFromText()` bounds the segment to 160 chars and cuts it at the next bucket label
   (`5-hour|weekly|opus|sonnet|resets|extra usage|…`), so a context row with no number reads as
   *no number*.
2. `CU_CTX_TTL` (8 min) plus `cuRouteWatch()`, which wraps `history.pushState/replaceState` and
   clears the reading the moment the SPA navigates.
3. When context is unknown the chip **drops the segment entirely** rather than rendering `--`. The
   plan buckets keep their placeholder, because for those "--" genuinely means "the fetch is
   failing" and is worth seeing.

**Lesson:** an unlabelled number next to other numbers gets read as belonging to whichever label is
nearest. Showing nothing is a real answer.

---

## 35. The floating usage chip swallowed clicks meant for the app (2026-08-21)

**Symptom:** "the usage widget hovers exactly on top of a session on my home tab, and I cannot
archive it."

**Root cause:** `cuPlace()` has two modes - inlined next to the app's own usage control in the
composer footer, or, when that control isn't on the page (the home tab, sometimes the code tab), a
fixed corner overlay on `<body>`. In that fallback the wrapper was `pointer-events:none` but
`.cc-u-chip` was `pointer-events:auto` unconditionally, so the chip's own ~120x20px rectangle
intercepted hover and clicks for whatever was painted underneath - on the home tab, a session row
and its archive control.

**Fix:** floating mode is click-through by default (`#cc-usage[data-float="1"] .cc-u-chip
{pointer-events:none}`). `cuArmWatch()` adds `.cc-armed` - which restores `pointer-events:auto` and
shows the card - only after the pointer has rested inside the chip for 200ms; leaving disarms it at
once. The rect is cached for a second so the document-level `mousemove` isn't forcing layout
thousands of times a minute. Attached mode is unchanged.

**Lesson:** "sometimes it's there, sometimes it isn't" on an overlay usually means it has two
placement modes and you're only thinking about one of them.

---

## 36. The panel-hiding fix was the wrong fix (2026-08-21)

**Symptom (feedback):** "the project picker shouldn't disappear, it should just go under things."

**Root cause:** #30 solved the right problem the wrong way. Hiding on overlay-open works, but a
panel that vanishes is harder to reason about than one that is simply behind something - and it
needed a detector that had to keep guessing which roles count as "modal".

**Fix:** the detector is gone. `z-index` dropped from `2147482000` to **30**. claude.ai's overlays
are Radix portals in the z-40/z-50 band and ordinary page content is z-auto, so a value between the
two paints over the composer and under every dialog, including ones we have never seen - no
enumeration required.

**Lesson:** reach for the stacking context before reaching for a detector. The detector was ~35
lines and a maintenance liability; the correct answer was one number.

---

## 37. The panel covered the sidebar on a narrow window (2026-08-21)

**Symptom:** "when my window is small, the project selector gets on top of the sessions too."

**Root cause:** `clampPanel()` positioned the panel at the workspace row's left edge, then, if the
target width overflowed the viewport, slid it LEFT (`left = vw - WS_MARGIN - w`) - straight across
the session list. On a narrow window that branch is guaranteed.

**Fix:** the row's left edge is now a hard floor (`minLeft`), and the width is derived from what is
left over (`vw - WS_MARGIN - left`). It shrinks instead of sliding. The workspace row lives in the
main content column, so its left edge is a reliable stand-in for where the sidebar ends without
having to identify the sidebar at all.

The floating usage chip had the same problem for the same reason and gets the same treatment, except
that it genuinely has to find the sidebar (it isn't anchored to anything in the content column).
`cuSidebarRight()` identifies it geometrically - tall, pinned to the left edge, under half the window
wide - never by class name, because these class names are generated.

---

## 38. Local project switching broke completely (2026-08-21, same day, self-inflicted)

**Symptom:** "it still struggles with changing projects. Even local ones."

**Root cause:** two bugs, one old and one introduced by #31 that morning.

1. *Introduced.* #31's "keep only innermost matches" was too broad. The connection menu's "Local"
   row contains a nested control, so the labelled row was dropped in favour of an unlabelled child
   and the menu scraped as `["", "Cloud", "Remote Control", "SSH"]`. No match, and `clickWorkspace`
   then hit `if (!connTarget) { document.body.click(); return; }` - returning before the folder step.
   Fixing "opens the wrong project" had produced "opens no project".
2. *Old, and the more interesting one.* `currentConn` was read as
   `connBtn.querySelector('span,div')?.textContent` and has returned `""` on every build for as long
   as the log goes back - every `[cc-ws-debug]` line reads `"from":""`. An empty string never equals
   the wanted connection, so the connection menu was opened and driven **on every single click**,
   including the overwhelmingly common case of already being on Local. Every bit of fragility in
   that path was being paid for when there was nothing to switch.

**Fix:** dedupe only when the descendant's text is *identical* to the ancestor's (that is the actual
`<li><button>` duplication and nothing else); read the whole button with `aria-label` first and
compare by normalised containment, since the label reads "Local, environment settings, right arrow";
and treat a missing connection target as "stay on the current one and carry on to the folder"
rather than as fatal.

**Lesson:** `"from":""` was sitting in the log for days. A debug field that is always empty is a
finding, not noise.

---

## 39. SSH hosts are in a submenu, and named differently than ssh knows them (2026-08-21)

**Symptom:** "I'm not seeing projects from my other servers", and remote switching never worked.

**Root causes**, three of them:

1. The connection menu lists *categories* - Local / Cloud / Remote Control / SSH - and the hosts are
   in a submenu under SSH. Nothing ever opened it, so a host name was never among the scraped items
   and no amount of match-tuning could have helped.
2. The Remote column was built solely from `cc-ws-v4`, which only knows what our code observed, and
   which recorded nothing at all between July and #33. Meanwhile the app keeps the same information
   in the renderer's own localStorage under `desktop-recent-workspaces` - same origin, no IPC needed -
   and the configured hosts in `~/.config/Claude/ssh_configs.json`.
3. The panel knows a connection by its **display name**; ssh needs the **target**. They differ:
   `Myserver`→`myserver`, `MyHostinger`→`root@…` (+ an identity file), `Dad`→`Dr`. The
   first ssh implementation validated the display name as if it were a hostname, and rejected `@`.

**Fix:** open the SSH category when the host isn't at the top level; merge three sources into the
Remote column (ours, the app's, and every configured host, so an unused server still appears);
resolve display name → target + identity file in the main process from the app's own config file.
Host headings are also buttons now - they open the ssh file browser at `/`, so a server that has
never been used here is still reachable.

Verified against all three real hosts: `cc-ssh-configs` resolves them, `ls` and `cat` succeed
(including a path containing a space), and `"/tmp'; id #"` as a path comes back as a literal
filename rather than a second command.

---

## 40. ActivityWatch only ever saw the window titled "Claude" (2026-08-21)

**Symptom:** "the Claude ActivityWatch watcher isn't giving the window title to ActivityWatch."

**Root cause:** not the watcher, and not `titlewatch.js`. The KWin watcher is running and logging
Claude regularly - every event in the bucket read `{"app":"Claude","title":"Claude"}`. `titlewatch.js`
was correctly setting `document.title`; Electron just wasn't mirroring it onto the BrowserWindow (an
app-side `page-title-updated` suppression or an explicit `setTitle`).

**Fix:** a `cc-set-title` IPC. The renderer asks, the main process calls `win.setTitle()` directly,
which nothing overrides. `titlewatch.js` calls it alongside the existing `document.title` write.

**Lesson:** "the page title is set" and "the window title is set" are two different facts. Check the
consumer's data (the bucket) before touching the producer.

---

## 41. Menu rows stopped carrying their names, and everything keyed on text went blind (2026-08-25)

**Symptom:** picking a project was slow, and the SSH host stage could not be got past at all.

**Evidence, not guesswork.** Every `[cc-ws-debug]` line from 2026-08-22 onward is identical:

```json
{"stage":"conn","conn":"Local","from":"","found":false,
 "items":["","Cloud","Remote Control","SSH"]}
```

On 2026-08-21 that same first row read `"Local, environment settings, right arrow"`. The build
changed where a menu row keeps its name; `textContent` now returns `""` for it.

**Two consequences, one cause:**

- `from:""` means the current connection is unknown, so `alreadyOn` can never be true. The
  connection menu was therefore opened and driven on **every** click, Local to Local included -
  roughly 1.5-2s of choreography to switch to where we already were. That is the slowness, and it
  was never a performance problem; it was a matching problem.
- The Local row scores 0 against every candidate, so `found:false`, so no connection can be
  selected and the SSH submenu below it is unreachable.

**Fix:** `labelsOf(el)` collects every string a row might carry its name in - `aria-label`,
`data-value`, `value`, `title`, `data-path`, dereferenced `aria-labelledby`, nested
`[aria-label]/[title]/img[alt]`, and textContent - and `scoreEl()` takes the best score across all
of them. Adding candidates can only turn a miss into a hit, never a hit into a *different* hit,
because the scores are compared rather than concatenated. Every `.textContent`-based filter on that
path (`CONN_ACTION_RE`, `HOST_ACTION_RE`, the SSH-category find, `listed()`) moved to the same
helper.

The debug beacon now also logs `rowShape()` - the full attribute set of the first two rows - so if
the name ever moves somewhere `labelsOf` does not look, the next log line says where instead of
costing another round of guessing.

**Lesson:** this is the third bug (#31, #32, this) caused by reading a name off `textContent`. The
DOM is someone else's API and it is not versioned. Read every label source, score them, and log the
shape when nothing matches.

---

## 42. The keyboard walk would commit on ANY row (2026-08-25)

Found while fixing #41, in the same blind spot. `sameItem(hot, target)` ended with:

```js
(hot.textContent || '').trim() === (target.textContent || '').trim()
```

With the current build that compares `""` to `""` for every row in the menu - so `keyboardPick`
believed it had arrived the instant it highlighted *anything*, and pressed Enter there. Identity
and containment are checked first, which is why this did not fire constantly, but whenever the walk
was mistimed it committed to the wrong row.

This is the more dangerous half of #41: the matcher merely failed to find, this one *acted*. Fixed
by comparing `bestLabel()` and requiring both sides to be non-empty.

**Lesson:** an equality test between two values that can both be empty is a test that passes by
default. Guard the empty case explicitly.

---

## 43. Sleep was blocked for the whole session, not while working (2026-08-25)

**Symptom:** the machine never slept overnight; KDE showed "Claude Desktop is blocking sleep
(Electron)" in the morning with nothing running.

**Root cause:** not a leaked assertion, and nothing to do with whether an agent was running. In the
main chunk the blocker has exactly one claimer:

```js
const s7e="keepAwakeEnabled";
function a7e(){kt("keepAwakeEnabled")===!0?GTn(s7e):ZTn(s7e)}
function XTn(){ks.on("keepAwakeEnabled",a7e),a7e()}
```

It claims `powerSaveBlocker('prevent-app-suspension')` once at startup and holds it until quit.
`main.log` had a single `[keep-awake] started (id=0, first claim=keepAwakeEnabled)` from three days
earlier and no matching `stopped`.

The pref **defaults to false**. It is flipped on for you - the build carries a
`wakeSchedulerCourtesyFlippedKeepAwake` flag - which is why turning it off by hand does not stay
off, and why it was on without ever having been set.

**Why the app's own per-turn assertions do not help on Linux:** `releaseTurnBlocks` releases
`heldPSSAssertions` through `u7e()`, which is `Ft.wakeScheduler` - the macOS Swift bridge, null
here. The remaining signal, `chainActive`, only covers the cloud-agent bridge, not local sessions.

**Fix:** `update-ui.sh` rewrites `a7e` so the claim is gated on `globalThis.__ccWorkActive()`, and
patches the installer to re-evaluate on a 60s interval rather than only on a settings change. An
appended IIFE defines the predicate: any `local_*.json` in the profile's `claude-code-sessions`
touched within the idle window (default 30 min, `CC_KEEPAWAKE_IDLE_MIN` to change) means working.
Located by the pref-name string, since every identifier in it is regenerated per release.

Two deliberate choices:

- **mtime, not `lastActivityAt`.** That field only moves at turn boundaries - a live session
  measured 16 minutes stale mid-turn - and a window that short would suspend the machine in the
  middle of a long run. mtime is a superset of real activity, and erring toward "busy" is the
  direction that cannot lose work.
- **Not keyed on window focus.** An app left focused overnight is exactly the reported situation.

Fails safe: if the predicate is missing or throws, `_busy` stays true and the old
block-forever behaviour returns.

**Still open:** the second inhibitor in the same KDE panel - "blocking screen locking (Capturing)"
- is a separate Chromium capture inhibitor and its owner has not been traced.

---

## 44. The usage chip parked on top of the session list in the Code tab (2026-08-25)

`cuSidebarRight()` pushed a left-corner chip past the sidebar, but only searched
`nav, aside, [class*=sidebar], [data-testid*=sidebar]`. The Code tab's session list is none of
those, so it returned 0 there and the chip sat in the bare left corner - on a project row. The
comment above it already described this exact failure happening in Cowork (#35 era); the selector
list was simply not the fix, because the thing being looked for has no stable tag or class.

**Fix:** scan by geometry alone - any element pinned to the left edge, at least half the viewport
tall, narrower than half the viewport wide - descending only through boxes too wide to be a pane
themselves, and depth-capped at 12. Nothing about it depends on what the pane is called.

**Lesson:** when a selector list keeps needing another entry, the selector list is the bug.

---

## 45. Per-project open-TODO counts (2026-08-25, feature)

Not a bug. Each tile now shows how many unticked boxes its `TODO.md` has: the number itself in
every mode, three stepped intensities (1-3 / 4-9 / 10+), and the exact "N open of M" in the
tooltip. Emoji mode shipped with a bare 6px dot instead of a number, on the assumption that a tile
had no room; the user reported the missing figure, and 8.5px tabular numerals in a 13px corner
pill fit fine (2026-08-26). The stepping now only tints the named modes - in emoji mode the digit
carries the magnitude, so the badge is drawn at full strength.

No new IPC - it counts the same TODO.md text the preview pane already receives (baked at build
time, refreshed live over `cc-ai-data-v2`). The regex is deliberately strict about markdown list
syntax; anything looser starts counting checkboxes quoted inside code fences, and an inflated
number is worse than no number because you stop trusting it.

---

## 46. The usage chip attached itself to a session row, because a chat was named "planning" (2026-08-26)

**Symptom:** the chip's three percentages were painted across the sidebar session row *Fable
project critique and planning*, with the hover card floating over the project list. Not the
bottom-left corner this time (that was #44) - it was inline, inside the row.

**Root cause:** `cuFindNative()` looked for the app's own usage control with

```
button[aria-label*="usage" i], button[aria-label*="limit" i], button[aria-label*="plan" i]
```

`plan` is a **substring** of `planning`, so the row's ⋯ overflow button - `aria-label="More
options for Fable project critique and planning"` - matched. Every geometric guard then passed,
because that button really is a 20x20 icon button, and `cuPlace()` inserted the chip into its
container and collapsed the ⋯ to `width:0`.

The evidence was sitting in the beacon the whole time: the `[cc-dump]` line lists that button
*first* in `usageButtons`, above the real `"Usage: context 0, plan 38%"` one. Document order
decided the match, and the wrong one comes first.

**Fix:** three changes in `custom-ui/usage.js`.

- The attribute selector stays as a cheap prefilter, but the real test is now a **word-boundary
  regex** (`\busage\b`, `\b(usage|plan|rate|weekly|5-hour|context)\s+limits?\b`), plus a
  rejection list for labels that announce themselves as controls *for* something else
  ("more options", "options for", "menu for").
- Candidates are **scored, not first-wins**: leading "Usage", carrying a `%` or the word
  "context", and sitting in the bottom half of the window. Several buttons can legitimately pass
  the label test; the composer-footer one wins.
- Anything inside `[role="listitem"] / [role="row"] / [role="option"] / li / a[href]` is
  rejected outright. A control inside a list row belongs to that row, whatever it is called.

Also added `cuUncollapse()`: the collapsed button is remembered and restored when the match moves
or the chip falls back to floating. Without it a mis-collapsed row control stayed 0px wide until
React happened to remount it.

**Lesson:** `[attr*="word"]` is not a word match. Every selector in this file that reads like
English is a substring match against strings the *user* writes - chat titles, project names - so
it is only ever one well-named conversation away from matching. Same failure family as #44 ("when
a selector list keeps needing another entry, the selector list is the bug"), one layer down: here
the list was right and the *matching rule* was wrong.

---

## 47. `claude-ctl` reported the keep-awake governor as inactive while it was visibly working (2026-08-26)

**Symptom:** KDE showed "Claude Desktop is blocking sleep" a minute after the app was opened with
nothing running, and `claude-ctl` said `legacy: claimed at startup, governor not active (restart
pending)` - which reads as "#43 never shipped".

**Root cause:** two separate things, neither of them the governor being broken.

1. `keepawake_state()` grepped `main.log` for our own `[cc-keep-awake]` lines. Those are written
   with a bare `console.log` from the main process, and **electron-log's file transport does not
   capture bare console output** - only its own logger. So the grep found nothing and the
   function fell through to its "legacy" branch. The app's own `[keep-awake] started/stopped`
   lines were right there and told the true story: repeated start/stop pairs, which the unpatched
   build (claim once, hold until quit) can never produce.
2. The blocker genuinely was held, correctly, by the governor's own rule. The predicate is "some
   `local_*.json` under `claude-code-sessions` was touched inside the idle window", and opening
   the app writes one. So *opening the app* counts as work for a full 30 minutes even if nothing
   runs. Confirmed against the log: released 00:28 (last write 23:57 + 30m), re-claimed 00:32
   after a new session file at 00:31.

**Fix:** `keepawake_state()` now reads the app's own started/stopped lines, and treats the
existence of any `stopped` as proof the governor is live. A second line, `keepawake_reason()`,
prints the age of the newest session file against the window, so the status answers *why* it is
awake instead of just *that* it is. Window kept at 30 min by decision (2026-08-26) - a live turn
writes those files every few seconds, so the window is only ever about how long the tail hangs on.

**Lesson:** a status command that infers state from *our* log lines inherits every gap in that
log's plumbing. Prefer evidence the app itself writes, and pick a signal whose *absence* is also
meaningful - "a stopped line exists" survives restarts, log rotation, and our own console going
nowhere.

---

## 48. The open-TODO badge painted its number in its own background colour (2026-08-26)

**Symptom:** "when the dot is white, the number on it is white; when the dot is black, the number
is black." Both badge shapes were affected - the tile dot in emoji mode and the pill in the named
modes - so the count was unreadable in whichever theme happened to collide.

**Root cause:** the badge borrowed both of its colours from the surrounding page, and got neither.

1. The tile dot was `background:currentColor` with the digit in `color:var(--bg-100,#1a1a1a)`.
   `--bg-100` is declared on `.dframe-content-inner`, and the panel is appended to `<body>` -
   *outside* that element - so the variable never resolved and the digit was always the literal
   fallback `#1a1a1a`, while the ground followed whatever text colour the panel had inherited.
   In dark mode both ended up dark. The pairing was never robust; it just happened to work in
   light mode, which is where it was written.
2. The pill's three intensity steps were applied as `opacity` on the badge element, which fades
   the text along with the ground. The lowest step, `0.42`, is the one used for 1-3 open items -
   so the quietest projects, the common case, had the least readable number.

**Fix:** the badge stops borrowing. `css.js` carries `.cc-todo-dot` / `.cc-todo-pill` with an
explicit foreground/background pair per theme, chosen against the panel's *own* hardcoded
background (`#f2e8d5` light, `#2e2919` dark) rather than against the app's palette. Intensity is
now three background tints (`.cc-l1` / `.cc-l2`); the digit is full strength at every count.

**Lesson:** `currentColor` and a `var()` fallback look theme-aware and are not - together they are
two independent guesses about the same surface. Anything drawn on the panel should take its colours
from the panel, which is the one background this code actually controls. And check where a CSS
variable is *declared* before consuming it: the panel deliberately lives outside the app's tree,
so app-scoped variables silently fall back there, every time.

---

## 49. The empty band above the tab pills was one variable, not a layout (2026-08-26)

**Symptom:** ~36px of dead space above the "Chat and Cowork" / "Code" pills, present since the
window went back to a native KWin frame. Standing TODO item, previously blocked on "measure it
first" - and the `topChain` probe added for exactly that came back with `anchor:null`, because it
matches a pill by `textContent` and the 08-22 build stopped putting text in those nodes (#41).

**Root cause:** `.dframe-root[data-wco]{--df-chrome-bar-height:36px}` in the app's own stylesheet.
`data-wco` marks "the app draws its own window controls in an overlay strip", and the variable has
exactly two consumers: `.dframe-content{padding-top}` and `.dframe-sidebar{top:calc(8px + …)}`.
Since the main window became `titleBarStyle:"default"` and KWin took over the frame, nothing is
ever painted in that strip.

**Fix:** `css.js` sets `--df-chrome-bar-height:0px!important` on `.dframe-root[data-wco]`;
`localStorage['cc-chrome-bar']='keep'` opts out. No element is hidden, which is what makes this
safe in a way the top-bar hider (#18) was not - the failure mode there was blanking a container.

**Lesson:** when a DOM probe fails, the shipped stylesheet is still evidence. Grepping the app's
CSS for the *consumers* of a length found the answer in one pass, and found it as a single named
variable rather than as a class to override - which is both a smaller patch and one that survives
a re-layout. The probe still needs fixing: anything in `diag.js` that finds a node by text is
blind on this build, same as everything `labelsOf()` had to replace.

---

## Maintenance note: `custom-ui/workspace.js` contained a literal NUL byte

Until 2026-08-25 the file held `normConn(currentConn || '\x00')` - a sentinel meaning "match
nothing". A NUL makes the file *binary* as far as grep is concerned, so `grep -n foo workspace.js`
printed **nothing at all** for a file full of matches, silently, with exit status 0. That cost real
time before it was noticed. The sentinel is gone (the empty case is now guarded explicitly) and the
byte is stripped. Do not reintroduce one; `file custom-ui/*.js` should say "JavaScript source" for
every module.

---

## Maintenance note: `update-ui.sh`'s heredoc is UNQUOTED

Twice in one session a *comment* inside the `python3 << PYEOF` block broke the build:

- A backslash escape (`[\r\n]`) was eaten before python saw it, producing an invalid JS regex
  literal. Caught by the script's own `node --check`.
- Backticks around a command name in a prose comment - "``ls -1pA`` marks directories" - were
  **executed by bash**, splicing a directory listing into the middle of a python string literal.
  This one is nastier: the error pointed at the opening line of a 174-line string concatenation and
  said "perhaps you forgot a comma".

Inside that heredoc, comments are code. No backticks, no `$(`, and no backslash escapes - use
`String.fromCharCode()` and `split()/join()` instead. There is now a scan for this; run it before
blaming python:

```bash
node -e 'const fs=require("fs"),BT=String.fromCharCode(96);const L=fs.readFileSync("scripts/update-ui.sh","utf8").split("\n");const s=L.findIndex(l=>l.includes("python3 << PYEOF")),e=L.findIndex((l,i)=>i>s&&l.trim()==="PYEOF");L.forEach((l,i)=>{if(i>s&&i<e&&(l.includes(BT)||/\$\(/.test(l)))console.log(i+1+": "+l)})'
```
