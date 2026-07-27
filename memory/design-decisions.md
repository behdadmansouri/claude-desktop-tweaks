# Design Decisions

**Whitelist over blacklist for visibility guards:**
When hiding a UI element on specific pages, use an explicit whitelist of allowed pages rather than a blacklist of excluded pages. Blacklists accumulate technical debt -- every new route needs a new exclusion rule. A whitelist (`/`, `/chat/...`, `/cowork`, `/new`) is stable and self-documenting.

**Absolute timestamps (ms epoch) over relative values:**
For time-based state (e.g., reset countdowns), store absolute millisecond timestamps (`Date.now()`) rather than computed relative values. Relative values go stale immediately; absolute timestamps age correctly without the popup being open and persist across navigation and restart. Applied to `_hourlyResetMs`, `_weeklyResetMs`, `localStorage['cc-reset-v1']`.

**Broad DOM scanners with guarded performance:**
When scanning DOM for user-visible text (e.g., reset times in popups), read `document.body.innerText` (visibility-aware, excludes hidden DOM) rather than guessing Radix selectors (which change across versions). Only run broad scans when at least one popup-like element is open (`[data-state="open"]`) to avoid performance regressions.

**Diagnostic beacon for major DOM changes:**
When a breaking DOM change hits (selectors return 0 matches despite working features), add a `ccDiag()` beacon that logs to `console.error` with ground-truth snapshots: inspect actual element structure, dump aria-labels, extract row attributes. Output goes to `claude.ai-web.log` (renderer level), visible without console access.

**Attribute selectors with blanket display:none are fragile:**
When Claude redesigns the UI, attributes get reused on different element types. A CSS rule like `[data-top-left="true"]{display:none!important}` will nuke the entire app if that attribute migrates from marking a title-bar element to wrapping the whole content tree. Always prefer size/position guards: "never hide an element taller than ~80px" or "never hide an element containing the composer or main content area". This survives attribute reuse and DOM structure changes. See issues-fixed.md #18 for the full incident.

**Native Ctrl+1/2/3 already switches chats (2026-07-10):**
Claude Desktop natively binds Ctrl+1/2/3 to switching between chats (confirmed by user). Our own capture-phase `keydown` handler in `custom-ui/topbar.js` also claims Ctrl+1/2/3 for a *different* purpose (switch main view: Chat/Cowork/Code) — currently harmless only because the whole handler block is disabled (`return;` guard, see "2026-07-10: disabled for now" comment at the top of the block). If that block is ever re-enabled, Ctrl+1/2/3 will need to be rebound to something else (or dropped) to avoid fighting the native chat-switch binding — same class of conflict as the earlier Ctrl+Shift+F → Ctrl+Shift+R move documented inline in that file.
