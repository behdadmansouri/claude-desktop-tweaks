# Performance & Security Review

---

## Security

| Area | Status | Notes |
|------|--------|-------|
| innerHTML injection | ✅ Safe | User data only enters DOM via `.textContent`, never `innerHTML` |
| localStorage reads | ✅ Safe | All wrapped in `try/catch`; JSON.parse failure returns empty defaults |
| `fireClick()` events | ✅ Safe | Only dispatched on user-initiated panel button clicks |
| Keyboard capture | ✅ Safe | `stopPropagation()` scoped to custom shortcuts only |
| WCO override | ✅ Safe | Modifies shim object (not native API); wrapped in try/catch |
| `cc-debug` localStorage | ✅ Safe | Stores element tagName + className substring; no sensitive data |
| Auto-dismiss | ✅ Safe | Only acts on single-button dialogs or exact "Attach/Cancel" pattern |
| Markdown renderer | ✅ Safe | `_mdInline()` builds DOM nodes via `textContent`; no `innerHTML` even for user-owned TODO files |

---

## Performance

| Area | Cost | Notes |
|------|------|-------|
| MutationObserver | Low | Debounced 300ms |
| `setInterval` (scan) | Low | 2s interval |
| `applyRings()` | Low | O(n) where n = sidebar rows |
| `hideTopBar()` | Near-zero after first run | Returns on `_topBarEl` cache hit; CSS does most work |
| `scanForUsageExtras()` | Low | Queries open popover containers only; guarded by `[data-state="open"]` check |
| `dismissStartupPopups()` | Near-zero | WeakSet check is O(1); only acts on new dialogs |
| `preferCodeTab()` | Near-zero | Skips already-seen tablists via `dataset.ccTabPref` |
| `hideUnavailableBanners()` | Low | Queries alert/status/banner roles; rarely many elements |
| `waitNewMenu()` async | Low | Only on user click; 60ms poll for 2.5s max |
| `patchWCOHeight()` | One-time | Guarded by `_ccPatched` flag |
| WeakMap `_badgeRebuild` | ✅ | No retention of detached elements |
| `refreshUsagePopover()` | Low | Gated: requires focus + no open menus + 8s since last input |
