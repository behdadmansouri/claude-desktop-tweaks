# Claude Desktop — TODO & Feature Status

Last updated: 2026-06-18 (session 2)

---

## Implemented Features ✅

### Usage & Plan Tracking
- [x] Usage badges: `C35% H81% 2h W45% 3d` (context/hourly/weekly + reset times)
- [x] Reset times persist via `cc-reset-v1` localStorage (survive popup close + navigation)
- [x] Floating usage pill repositioned to bottom-right (avoid top-bar overlap)
- [x] Floating pill hidden on Code tab (shows only on `/`, `/chat/`, `/cowork`, `/new`)
- [x] Hourly reset time `h` included in floating bar

### Keyboard Shortcuts
- [x] **Ctrl+Q** — quit app (clean shutdown via IPC)
- [x] **Ctrl+O** — open search (same as Ctrl+K)
- [x] **Ctrl+Shift+L** — toggle sidebar (4-strategy fallback detection)
- [x] **Ctrl+Shift+R** — toggle right panel (artifact/code viewer)
- [x] **Ctrl+W** — close file viewer / dismiss preview (repurposed from redundant Ctrl+N)
- [x] **Alt+1-9** — jump to Nth chat in sidebar (broadened selector; non-QWERTY fallback via `e.code`)
- [x] **Ctrl+1** — switch to Chat mode
- [x] **Ctrl+2** — switch to Cowork mode
- [x] **Ctrl+3** — switch to Code mode
- [x] **Ctrl+;** — open side chat (built-in)

### UI Layout
- [x] Top bar hidden (CSS + WCO shim patch reporting 0px height + resize event)
- [x] Space reclaimed after top bar removal
- [x] dframe layout fixed (`padding-top:0!important`, sidebar `min-height:100%`)
- [x] New-session overview hidden (re-enable: `localStorage.ccShowOverview='1'`)
- [x] Code tab auto-select in artifact panel (when artifact opens, auto-click Code if present)

### Sidebar Features
- [x] Chat number badges (1–9) on first 9 sidebar chats
- [x] Chat badges visible via `Alt+1-9` reference
- [x] Pin chats (📌 button on hover)
- [x] Pinned chats highlighted with amber outline
- [x] Cache ring (teal outline on chats with warm prompt cache)
- [x] Cache ring: 5-minute TTL matching Anthropic cache window
- [x] Cache ring: uses inline `style.setProperty('outline', ...)` (survives React re-renders)
- [x] Rate-limit ring (red outline on "too many requests" chats)
- [x] Rate-limit detection via text scan in chat
- [x] Rate-limit state persists in `cc-ratelimit` localStorage

### Workspace Features
- [x] Workspace panel (Local + SSH columns)
- [x] Workspace panel hover-triggered (hidden by default, shown on mouseenter)
- [x] Workspace panel: Local column from `~/Documents/AI Projects/` (baked at patch time)
- [x] Workspace panel: SSH column from localStorage recents (`cc-ws-v4`)
- [x] Workspace panel: 2-column grid layout when >4 items
- [x] Workspace panel: dark mode colors (CSS vars + media query fallback)
- [x] Workspace panel: folder click via keyboard nav (Home → ArrowDown → Enter)
- [x] Workspace panel: emoji suffix moved to end of folder names (`emojiSuffix()`)
- [x] Workspace panel: solid background `var(--bg-100, #f5f4ef)` with dark mode override

### Dialogs & Banners
- [x] Startup popup auto-dismiss (single-button dialogs after 300ms)
- [x] "Attach debugger?" dialog auto-dismiss (auto-clicks Cancel after 200ms)
- [x] "Model unavailable" banner hidden (text scan + `display:none` on parent)

---

## Partially Working ⚠️

| Feature | Status | Notes |
|---------|--------|-------|
| **Ctrl+1/2/3 nav shortcuts** | ⚠️ | Added 2026-06-16; searches nav/sidebar elements by text+aria-label; selectors may need re-verification in latest Claude version |
| **Right panel tab injection** | ⚠️ | Selector `[data-testid="artifact-panel"]` unverified; Preview/Code/Files tabs not confirmed visible |

---

## Not Yet Implemented ❌

### Features Requested but Not Feasible
- [ ] Weekly usage circle (3rd circle for weekly %) — data not reliably available in DOM
  - Decision: floating bar shows W% instead; sufficient
  - Reason: weekly usage % rendered inconsistently across page states
- [ ] Workspace "New Project on SSH" — requires main-process IPC to create remote directory
  - Decision: out of scope (requires C++ Electron changes)
  - Reason: preload can't create directories; needs main process cooperation
- [ ] KDE native titlebar hiding — system-level window rule, not renderer patch
  - Decision: out of scope (OS-level, not app-level)
  - Reason: use KDE Window Rules to hide per-app

### Potential Future Features
- [ ] Third sidebar usage ring/badge (weekly W%)
- [ ] Right-click context menus on sidebar chats (quick pin/favorite/archive)
- [ ] Workspace recents cleanup UI (remove old SSH sessions)
- [ ] Custom chat/project color coding in sidebar
- [ ] Session export to markdown/JSON

---

## Outstanding Work / Next Steps 📋

### Verification Tasks (Open Threads)
- [ ] Restart Claude Desktop after latest changes and verify all features render correctly
- [ ] Test Alt+1-9 navigation with updated selector (broadened to `a[href*="/chat/"]` filtered by `offsetParent`)
- [ ] Inspect `cc-ring-diag` localStorage to confirm cache ring detection working
- [ ] Verify emoji suffix in workspace folder names (moved from prefix to suffix)
- [ ] Test workspace folder click keyboard nav fallback (Home → ArrowDown → Enter)
- [ ] Confirm Ctrl+1/2/3 nav shortcuts find correct nav elements
- [ ] Check right panel tab selectors match current DOM structure
- [ ] Verify rate-limit red ring appears when "too many requests" error triggered

### Documentation Tasks
- [x] Consolidate `CLAUDE.md` + `agents.md` into single authoritative reference
- [x] Create comprehensive feature status table (implemented/partial/not-planned)
- [x] Document all keyboard shortcuts in `shortcuts.md`
- [x] Move scripts to `scripts/` folder for organization
- [ ] Update symlinks: `update-ui.sh` symlink at `~/.config/Claude/update-ui.sh` points to `scripts/update-ui.sh`
- [ ] Update symlinks: `claude-quit` at `~/.local/bin/claude-quit` still points to old location

### Code Cleanup
- [ ] Verify `refresh-folders.sh` is no longer needed (defunct since v8 loader rewrite)
- [ ] Consider removing `cdp-debug.py` (non-functional since v1.9255.0; could archive instead)
- [ ] Audit custom-ui.js for any debug logging that should be removed

### Maintenance
- [ ] Plan update process for next Claude Desktop release (when /opt/claude-desktop/ upgrades)
- [ ] Consider creating a CI/auto-patch script for version updates
- [ ] Update GitHub repo links in CLAUDE.md if needed

---

## Session History Reference

**v8 (2026-06-18):** Fixed critical loader injection bug. v1–v7 contained 40+ fixes for negative space, layout, reset times, dark mode, and more. See `wiki.md` for full session details.

**Current state:** All core features working. Pending only verification testing on latest version and symlink updates.

---

## How to Test a Feature

1. **Edit `custom-ui.js`**
2. **Run:** `./scripts/update-ui.sh`
3. **Quit:** `~/.local/bin/claude-quit` (fully kill app)
4. **Relaunch:** from app menu or `~/.local/lib/claude-desktop-patched/AppRun &`
5. **Verify:** check console for `[custom-ui] ok` marker
6. **Check localStorage:** inspect feature-specific keys (see `CLAUDE.md` → Debugging)

---

## Priority Matrix

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 🔴 Critical | Loader injection (fixed v8) | High | All features depend on it |
| 🟡 Important | Verification of all 20+ features | Medium | Ensure nothing regressed in v2.1.181 |
| 🟡 Important | Symlink updates (points to scripts/) | Low | Install/usage still works but directory moved |
| 🟢 Nice-to-have | Ctx+1/2/3 selector tuning | Low | Rarely used, partial workaround via `history.pushState` |
| 🟢 Nice-to-have | Right panel tabs | Low | Artifact panel works without custom tabs |
| ⚪ Backlog | Auto-update CI pipeline | Medium | One-time effort, helps future maintenance |
