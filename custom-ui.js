/**
 * Claude Desktop custom UI - v19
 * Generated from custom-ui/ modules by update-ui.sh - do not edit directly.
 */
(function () {
'use strict';

// ─────────────────────────────────────────────────────────────
//  BASE CSS - injected once
// ─────────────────────────────────────────────────────────────
// 2026-07-12: dropped the top-bar padding-collapse rules (and the 6px
// hover-bug patch-of-a-patch they required) after the v3.0.0 packaging
// rebase removed the WCO/frame-fix shim entirely - the official Linux
// build now handles the window frame and topbar spacing natively, so
// there's no titlebar-reserved space left to collapse. See
// memory/maintenance.md for the rebase details.
function injectBaseCSS() {
  if (document.getElementById('cc-base-css')) return;
  const s = document.createElement('style');
  s.id = 'cc-base-css';
  s.textContent = [
    // ── empty space left of project/chat names ──
    '.df-leading-slot{margin-right:0!important;padding:0!important;min-width:0!important;width:auto!important;}',
    '.df-leading-slot>*{margin-right:0!important;}',
    '.df-leading-slot:empty{display:inline-block!important;width:4px!important;min-width:4px!important;margin:0!important;}',

    // ── dark-mode override for the workspace/project-picker panel ──
    // .cc-ws-panel's background is hardcoded to a light sepia (#f2e8d5) in
    // workspace.js (inline style, needed as the light-mode default since the
    // panel isn't a native Claude element and has no theme-aware background
    // otherwise). This CSS rule (with !important) wins over the inline
    // style. Text/buttons inside already use `color:inherit` + CSS vars
    // (var(--claude-border), var(--bg-200)) so they adapt automatically once
    // the background is fixed.
    // The dark tone is warmed to match: monochrome emoji need a ground with
    // some chroma to separate from, in either theme.
    '@media (prefers-color-scheme:dark){' +
      '.cc-ws-panel{background:#2e2919!important;border-color:rgba(255,255,255,.12)!important;}' +
      '.cc-ws-panel button{color:inherit!important;}' +
    '}',
  ].join('\n');
  document.head.appendChild(s);
}

// ─────────────────────────────────────────────────────────────
//  QUICK WORKSPACE PANEL
//  Two-column floating panel (Local | Myserver) on new-session pages.
//  Hover-triggered; Local column live via cc-ai-data IPC or baked CC_AI_LOCAL.
// ─────────────────────────────────────────────────────────────
const WS_KEY    = 'cc-ws-v4';
const PANEL_CLS = 'cc-ws-panel';

// Tracks dialogs already handled, so the SSH remote-folder-browse dialog
// below doesn't re-trigger on the same dialog element.
const _seenDialogs = new WeakSet();

// "Time Management ⏱️" or "⏱️ Time Management" → {emoji:"⏱️", text:"Time Management"}
// Emoji and text are kept separate so the panel can render the emoji in its
// own span - it gets scaled up (see EMOJI_CSS) to be easier to pick out at a
// glance, and emoji-only mode drops the text entirely.
//
// This used to only look for a LEADING emoji, which is backwards: the workspace
// naming convention puts it at the END ("Claude Desktop 🤖", "Product Hunt 🛒"),
// so every folder came back emoji-less and "emoji only" mode silently did
// nothing at all. Both ends are checked now, suffix first since that is what
// this workspace actually uses.
//
// The candidate run has to contain a real pictograph. Matching "any non-letter"
// would read the trailing "." of a folder called "v1." - or the leading "." of
// a dotfile - as an emoji and eat it.
const PICTO_RE = /\p{Extended_Pictographic}/u;
function splitEmoji(name) {
  const post = name.match(/^(.*?[\p{L}\p{N}])[\s]*([^\p{L}\p{N}\s]+)$/su);
  if (post && PICTO_RE.test(post[2])) return {emoji: post[2].trim(), text: post[1].trimEnd()};
  const pre = name.match(/^([^\p{L}\p{N}]+)([\p{L}\p{N}].*)$/su);
  if (pre && PICTO_RE.test(pre[1])) return {emoji: pre[1].trim(), text: pre[2].trimEnd()};
  return {emoji: '', text: name};
}

// "⏱️ Time Management" → "Time Management ⏱️" (TODO-preview header)
function emojiSuffix(name) {
  const {emoji, text} = splitEmoji(name);
  return emoji ? text + ' ' + emoji : text;
}

// Oversized emoji that does NOT grow the line box: `line-height:0` makes an
// inline element contribute nothing to the line height, so rows stay the same
// height as text-only rows no matter how large font-size gets.
//
// That trick is right for a NAMED row, where the text sets the row height, and
// catastrophically wrong for an emoji-only tile, where the emoji is the only
// child: the button's content box collapsed to zero, leaving a 6px-tall hit
// target under a 21px glyph. The glyphs painted over each other and nothing was
// clickable. Emoji-only tiles use TILE_CSS instead, which gives them a real box.
const EMOJI_CSS = 'font-size:1.5em;line-height:0;display:inline-block;' +
  'vertical-align:-0.08em;flex:none;';
const TILE_PX = 30;
const TILE_CSS = 'font-size:19px;line-height:1;display:flex;align-items:center;' +
  'justify-content:center;width:100%;height:100%;flex:none;';

// Emoji-only mode - show just the emoji for each project, no names.
const EMOJI_ONLY_KEY = 'cc-ws-emoji-only';
const emojiOnly = () => { try { return localStorage.getItem(EMOJI_ONLY_KEY) === '1'; } catch { return false; } };
const setEmojiOnly = v => { try { localStorage.setItem(EMOJI_ONLY_KEY, v ? '1' : '0'); } catch {} };

const CC_TODOS = (typeof CC_AI_TODOS !== 'undefined') ? CC_AI_TODOS : {};
function ccTodo(folder) {
  const live = (typeof window.__CC_TODOS__ === 'object' && window.__CC_TODOS__) || null;
  if (live && live[folder] != null) return live[folder];
  return CC_TODOS[folder];
}

// Sanitizing on WRITE (added in #21) never helped the entries already sitting
// in localStorage from before that fix, which is why the bottom of the SSH
// column kept showing unreadable tofu tiles. Clean on READ as well, and drop
// anything that has no readable characters left afterwards - a tile whose label
// is three zero-width spaces is unclickable and un-right-clickable, so it can
// never be removed through the UI either.
const hasReadable = s => /[\p{L}\p{N}]/u.test(s || '');
function loadWS() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(WS_KEY) || '[]'); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out = [];
  let dropped = false;
  for (const w of raw) {
    if (!w || typeof w !== 'object') { dropped = true; continue; }
    const conn = cleanLabel(w.conn), folder = cleanLabel(w.folder);
    if (!hasReadable(conn) || !hasReadable(folder)) { dropped = true; continue; }
    out.push({conn, folder, ts: w.ts || 0});
  }
  // Rewrite once so the garbage doesn't have to be re-filtered on every render.
  if (dropped) { try { localStorage.setItem(WS_KEY, JSON.stringify(out)); } catch {} }
  return out;
}
const saveWS = list => localStorage.setItem(WS_KEY, JSON.stringify(list.slice(0, 40)));

// Labels are scraped from button textContent, which can pick up characters
// that aren't part of the folder name at all - control/format codepoints, and
// private-use codepoints from icon fonts (the likely source of the unreadable
// tiles that showed up in the remote column). Strip them so the entry is
// readable and so two spellings of the same folder don't both persist.
function cleanLabel(s) {
  return (s || '').replace(/[\p{Cc}\p{Cf}\p{Co}]/gu, '').replace(/\s+/g, ' ').trim();
}

function recordWS(conn, folder) {
  conn = cleanLabel(conn);
  folder = cleanLabel(folder);
  if (!conn || !folder) return;
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const list = loadWS().filter(w =>
    !(same(cleanLabel(w.conn), conn) && same(cleanLabel(w.folder), folder)));
  list.unshift({conn, folder, ts: Date.now()});
  saveWS(list);
  rebuildPanel();
}

// Drop one recorded entry (right-click on a remote tile).
function forgetWS(conn, folder) {
  saveWS(loadWS().filter(w => !(w.conn === conn && w.folder === folder)));
  rebuildPanel();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Full pointer-event sequence for Radix UI / React
function fireClick(el) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const base = {bubbles: true, cancelable: true, clientX: cx, clientY: cy};
  el.dispatchEvent(new PointerEvent('pointerover',  {...base}));
  el.dispatchEvent(new MouseEvent  ('mouseover',    {...base}));
  el.dispatchEvent(new PointerEvent('pointerdown',  {...base, button: 0, buttons: 1}));
  el.dispatchEvent(new MouseEvent  ('mousedown',    {...base, button: 0, buttons: 1}));
  el.dispatchEvent(new PointerEvent('pointerup',    {...base, button: 0, buttons: 0}));
  el.dispatchEvent(new MouseEvent  ('mouseup',      {...base, button: 0, buttons: 0}));
  el.dispatchEvent(new MouseEvent  ('click',        {...base, button: 0, buttons: 0}));
}

const _MENU_SEL = '[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper],' +
  '[data-radix-select-content],[data-radix-dropdown-menu-content],[data-radix-combobox-content],' +
  '[data-cmdk-root],[data-cmdk-list],[cmdk-list]';
// Existing connections (Local/Myserver) render as a Radix radio-group of
// environments - role="menuitemradio", not "radio". Confirmed via cc-ws-debug
// logs (2026-07-10): the conn menu's static "Add cloud environment…" etc.
// actions were captured fine, but "Local"/"Myserver" never showed up even
// after a settle-time wait - they were invisible to this selector, not late.
const _ITEM_SEL = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],' +
  '[role="option"],[role="radio"],[role="checkbox"],' +
  '[data-cmdk-item],[cmdk-item],[data-radix-collection-item],li,button';

// Finds the newly-opened menu, then waits for its item count to STABILIZE
// before returning - not just for the first non-empty snapshot. Confirmed
// via cc-ws-debug logs (2026-07-10): the connection menu renders its static
// "Add cloud environment… / Set up Remote Control… / Add SSH host…" actions
// immediately, then appends existing connections (e.g. "Myserver") a beat
// later once they load. The old code grabbed the first 3-item snapshot and
// never saw "Myserver" at all - not a click failure, a race.
async function waitNewMenu(ms = 2500) {
  const existing = new Set(document.querySelectorAll(_MENU_SEL));
  await sleep(80);
  const deadline = Date.now() + ms;
  let candidate = null;
  while (Date.now() < deadline && !candidate) {
    for (const m of document.querySelectorAll(_MENU_SEL)) {
      if (!existing.has(m)) { candidate = m; break; }
    }
    if (!candidate) await sleep(60);
  }
  if (!candidate) return [];

  const grab = () => [...candidate.querySelectorAll(_ITEM_SEL)]
    .filter(i => i.textContent.trim() && !i.querySelector('[role="menuitem"],[role="option"]'));

  let items = grab();
  let lastCount = items.length;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(100);
    if (!candidate.isConnected) break; // menu closed under us
    items = grab();
    if (items.length !== lastCount) {
      lastCount = items.length;
      stableSince = Date.now();
    } else if (items.length > 0 && Date.now() - stableSince > 250) {
      break; // count held steady for 250ms with at least one item - settled
    }
  }
  return items;
}

// 3 = exact, 2 = one is a prefix of the other, 1 = loose substring, 0 = no.
//
// The old version returned a bare boolean with `it.includes(f) || f.includes(it)`
// and callers took the FIRST menu item that passed. "AI Projects" is a substring
// of "AI Projects Manager", "Behi Blueprint" of nothing but "Fashion" of
// "Fashion Archive", and so on - so picking a project could quietly open a
// different one whose name merely contained it. Scoring plus best-of lets an
// exact match beat an accidental substring no matter what order the menu is in.
function matchScore(itemText, folder) {
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = folder.split('/').filter(Boolean).pop() || folder;
  const it = norm(itemText), f = norm(name);
  if (!it || !f) return 0;
  if (it === f) return 3;
  if (it.startsWith(f) || f.startsWith(it)) return 2;
  if (it.includes(f) || f.includes(it)) return 1;
  return 0;
}

function matchFolder(itemText, folder) {
  return matchScore(itemText, folder) > 0;
}

// Best candidate, or null. A merely-substring match (score 1) is only accepted
// when it is the single candidate in the whole menu - otherwise it is exactly
// the ambiguity that used to open the wrong project.
function bestMatch(items, folder, textOf) {
  let best = null, bestScore = 0, bestCount = 0;
  for (const el of items) {
    const s = matchScore(textOf(el), folder);
    if (s === 0) continue;
    if (s > bestScore) { best = el; bestScore = s; bestCount = 1; }
    else if (s === bestScore) bestCount++;
  }
  if (!best) return null;
  if (bestScore === 1 && bestCount > 1) return null;
  if (bestScore >= 2 && bestCount > 1) console.warn('[cc-ws] ambiguous folder match for', folder);
  return best;
}

// Call React's own event handlers via the fiber tree.
// Bypasses isTrusted checks that block synthetic dispatchEvent clicks.
function tryFiberClick(el) {
  const fiberKey = Object.keys(el).find(k => /^__reactFiber/.test(k) || /^__reactInternal/.test(k));
  if (!fiberKey) return false;
  let fiber = el[fiberKey];
  for (let depth = 0; fiber && depth < 25; fiber = fiber.return, depth++) {
    const p = fiber.memoizedProps;
    if (!p) continue;
    for (const handler of ['onClick', 'onPointerUp', 'onMouseUp', 'onSelect']) {
      if (typeof p[handler] === 'function') {
        try {
          p[handler]({
            type: handler.replace(/^on/, '').toLowerCase(),
            button: 0, buttons: 0, isPrimary: true, bubbles: true,
            preventDefault: () => {}, stopPropagation: () => {},
            currentTarget: el, target: el,
          });
          console.log('[cc-ws] fiber handler fired:', handler);
          return true;
        } catch (e) { console.log('[cc-ws] fiber handler err:', handler, e); }
      }
    }
  }
  return false;
}

function findWsBtns(wsRow) {
  const menuBtns = [...wsRow.querySelectorAll('button[aria-haspopup="menu"]')];
  if (menuBtns.length >= 2) return [menuBtns[0], menuBtns[1]];
  const connBtn = menuBtns[0] || null;
  const allBtns = [...wsRow.querySelectorAll('button')];
  const folderBtn = allBtns.find(b => b !== connBtn) || null;
  return [connBtn, folderBtn];
}

async function clickWorkspace(conn, folder, wsRow) {
  console.log('[cc-ws] clickWorkspace', conn, folder);
  if (!wsRow?.isConnected) { console.log('[cc-ws] wsRow disconnected'); return; }
  const [connBtn, folderBtn] = findWsBtns(wsRow);
  console.log('[cc-ws] buttons found:', !!connBtn, !!folderBtn);
  if (!connBtn || !folderBtn) return;

  const currentConn = connBtn.querySelector('span,div')?.textContent?.trim() || '';
  console.log('[cc-ws] currentConn:', currentConn, '→ want:', conn);
  if (currentConn !== conn) {
    fireClick(connBtn);
    const connItems = await waitNewMenu();
    console.log('[cc-ws] conn menu items:', connItems.map(i => i.textContent.trim()));
    const connTarget = connItems.find(el => {
      const t = el.textContent.trim().toLowerCase();
      const c = conn.toLowerCase();
      // "Myserver" matches "myserver", "my server", "my server (ssh)", etc.
      return t.includes(c) || t.replace(/\s+/g, '').includes(c.replace(/\s+/g, ''));
    });
    const dbgConn = {
      ts: Date.now(), stage: 'conn', conn, from: currentConn, found: !!connTarget,
      items: connItems.map(i => i.textContent.trim().slice(0, 40)),
    };
    localStorage.setItem('cc-ws-debug', JSON.stringify(dbgConn));
    console.error('[cc-ws-debug]', JSON.stringify(dbgConn));
    if (!connTarget) { console.log('[cc-ws] conn target not found'); document.body.click(); return; }

    const connCommitted = () => !document.querySelector(_MENU_SEL) &&
      (connBtn.querySelector('span,div')?.textContent?.trim() || '').toLowerCase() !== currentConn.toLowerCase();

    // Approach 1: React fiber handler - bypasses isTrusted
    tryFiberClick(connTarget);
    await sleep(220);

    // Approach 2: keyboard nav - Radix keydown doesn't check isTrusted
    if (!connCommitted()) {
      const idx = connItems.indexOf(connTarget);
      const el = (document.activeElement && document.activeElement !== document.body)
        ? document.activeElement : connTarget;
      const kd = (key, code) =>
        el.dispatchEvent(new KeyboardEvent('keydown', {key, code, bubbles: true, cancelable: true}));
      kd('Home', 'Home');
      await sleep(60);
      for (let i = 0; i < idx; i++) { kd('ArrowDown', 'ArrowDown'); await sleep(45); }
      kd('Enter', 'Enter');
      el.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', code: 'Enter', bubbles: true}));
      await sleep(220);
    }

    // Approach 3: synthetic pointer sequence (last resort)
    if (!connCommitted()) {
      const stillOpen = document.querySelector(_MENU_SEL);
      const hot = (stillOpen?.querySelector('[data-highlighted],[aria-selected="true"]')) || connTarget;
      fireClick(hot);
      await sleep(220);
    }

    console.error('[cc-ws-debug] conn committed=' + connCommitted());

    await sleep(400);
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(d => d.offsetParent && !_seenDialogs.has(d));
    if (dialog) {
      const opts = [...dialog.querySelectorAll('[role="option"],li,button')]
        .filter(el => el.textContent.trim() && el.offsetParent);
      if (opts.length === 1) { fireClick(opts[0]); await sleep(400); }
      else return;
    }
  }

  if (!wsRow.isConnected) { console.log('[cc-ws] wsRow disconnected after conn switch'); return; }
  const [, fb] = findWsBtns(wsRow);
  if (!fb) { console.log('[cc-ws] folder button gone after conn switch'); return; }

  const folderBtnLabelBefore = (fb.textContent || '').trim();

  console.log('[cc-ws] clicking folder button');
  fireClick(fb);
  // SSH folder listings are fetched over the network and can be slow to
  // populate the dropdown - give non-Local connections more time.
  const folderItems = await waitNewMenu(conn === 'Local' ? 2500 : 6000);
  const menuRoot = document.querySelector(_MENU_SEL);
  const dbgItems = folderItems.map(i => ({
    t: i.textContent.trim().slice(0, 40),
    v: i.getAttribute('data-value') || '',
    r: i.getAttribute('role') || '',
  }));
  const folderTarget = bestMatch(folderItems, folder,
    el => el.getAttribute('data-value') || el.getAttribute('value') || el.textContent);
  const dbg = {
    ts: Date.now(), folder, found: !!folderTarget,
    menuTag: menuRoot ? (menuRoot.getAttribute('role') || menuRoot.tagName) : null,
    count: folderItems.length, items: dbgItems,
  };
  localStorage.setItem('cc-ws-debug', JSON.stringify(dbg));
  console.error('[cc-ws-debug]', JSON.stringify(dbg));

  const committed = () => {
    if (document.querySelector(_MENU_SEL)) return false;
    const nameNow = (fb.textContent || '').trim();
    const want = folder.split('/').filter(Boolean).pop() || folder;
    return nameNow !== folderBtnLabelBefore && matchFolder(nameNow, want);
  };

  if (folderTarget) {
    folderTarget.scrollIntoView({block: 'nearest'});
    await sleep(30);

    // Approach 1: React fiber handler - bypasses isTrusted
    tryFiberClick(folderTarget);
    await sleep(160);
    if (committed()) { console.error('[cc-ws-debug] committed via fiber'); return; }

    // Approach 2: Keyboard navigation - Radix keydown doesn't check isTrusted
    const targetIdx = folderItems.indexOf(folderTarget);
    if (targetIdx >= 0) {
      console.log('[cc-ws] keyboard nav to idx', targetIdx);
      const el = (document.activeElement && document.activeElement !== document.body)
        ? document.activeElement : folderTarget;
      const kd = (key, code) =>
        el.dispatchEvent(new KeyboardEvent('keydown', {key, code, bubbles: true, cancelable: true}));
      kd('Home', 'Home');
      await sleep(60);
      for (let i = 0; i < targetIdx; i++) { kd('ArrowDown', 'ArrowDown'); await sleep(45); }
      kd('Enter', 'Enter');
      el.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', code: 'Enter', bubbles: true}));
      await sleep(200);
      const stillOpen = document.querySelector(_MENU_SEL);
      if (stillOpen) {
        const hot = stillOpen.querySelector('[data-highlighted],[aria-selected="true"],[data-state="checked"]') || folderTarget;
        console.log('[cc-ws] Enter did not commit; clicking highlighted item');
        if (!tryFiberClick(hot)) fireClick(hot);
        await sleep(140);
      }
      console.error('[cc-ws-debug] after keyboard nav, committed=' + committed());
      return;
    }

    // Approach 3: Synthetic pointer sequence with isPrimary (last resort)
    console.log('[cc-ws] falling back to synthetic pointer events');
    const r = folderTarget.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pp = {bubbles: true, cancelable: true, clientX: cx, clientY: cy, isPrimary: true, button: 0};
    folderTarget.dispatchEvent(new PointerEvent('pointerover',  {...pp}));
    folderTarget.dispatchEvent(new PointerEvent('pointerenter', {...pp}));
    await sleep(20);
    folderTarget.dispatchEvent(new PointerEvent('pointerdown', {...pp, buttons: 1}));
    await sleep(20);
    folderTarget.dispatchEvent(new PointerEvent('pointerup',   {...pp, buttons: 0}));
    folderTarget.click();
    return;
  }

  // The app's Local folder dropdown only offers "Open folder…" (a native OS
  // picker) - it never lists projects. ccBridge.armFolder primes the main
  // process so the very next browseFolder IPC returns this path directly (no
  // dialog); React then sets it as the workspace. Falls back to the picker.
  const openItem = folderItems.find(el => /open folder/i.test(el.textContent || ''));
  if (folderItems.length <= 1 && openItem) {
    const want = folder.split('/').filter(Boolean).pop() || folder;
    if (window.ccBridge && typeof window.ccBridge.armFolder === 'function') {
      try {
        await window.ccBridge.armFolder(folder);
        fireClick(openItem);
        for (let i = 0; i < 12; i++) {
          await sleep(150);
          const [, fb2] = findWsBtns(wsRow);
          if (fb2 && matchFolder((fb2.textContent || '').trim(), want)) { document.body.click(); return; }
        }
        return;
      } catch (_) {}
    }
    fireClick(openItem);
    return;
  }

  // SSH: the remote folder dropdown only offers "Browse remote folder…" -
  // never actual remote directory names (confirmed via cc-ws-debug logs,
  // 2026-07-10). Clicking it opens a Claude-native remote directory browser
  // (root/back/subfolder entries + Go/Cancel/Select Folder action buttons -
  // confirmed via cc-ws-debug). We ONLY click a folder entry when its name
  // is an EXACT match in the currently-shown listing, then look for a
  // "Select Folder" confirm button. We deliberately never blind-click "Go"
  // or press Enter here - an earlier version did, using just the folder's
  // basename (not a real path) as the query, and it mis-fired into an
  // unrelated app dialog. Better to do nothing than guess wrong.
  const browseItem = folderItems.find(el => /browse.*folder|remote folder/i.test(el.textContent || ''));
  if (folderItems.length <= 1 && browseItem) {
    fireClick(browseItem);
    await sleep(500);
    const dlg = [...document.querySelectorAll('[role="dialog"]')]
      .find(d => d.offsetParent && !_seenDialogs.has(d));
    const dbg = {ts: Date.now(), stage: 'ssh-folder-dialog', folder, dialogFound: !!dlg};
    if (dlg) {
      _seenDialogs.add(dlg);
      const ACTION_LABELS = /^(go|cancel|select folder|ok|open|choose|confirm|back|up)$/i;
      const all = [...dlg.querySelectorAll(_ITEM_SEL)]
        .filter(i => i.textContent.trim() && !i.querySelector('[role="menuitem"],[role="option"]'));
      const entries = all.filter(i => !ACTION_LABELS.test((i.textContent || '').trim()));
      dbg.listedFolders = entries.map(i => i.textContent.trim().slice(0, 40));
      dbg.actionButtons = all
        .filter(i => ACTION_LABELS.test((i.textContent || '').trim()))
        .map(i => i.textContent.trim());

      const exactTarget = bestMatch(entries, folder, el => el.textContent);
      dbg.exactMatchFound = !!exactTarget;
      if (exactTarget) {
        if (!tryFiberClick(exactTarget)) fireClick(exactTarget);
        await sleep(300);
        const selectBtn = [...dlg.querySelectorAll('button')]
          .filter(b => b.offsetParent)
          .find(b => /^select folder$/i.test((b.textContent || '').trim()));
        dbg.selectFolderBtnFound = !!selectBtn;
        if (selectBtn) { if (!tryFiberClick(selectBtn)) fireClick(selectBtn); await sleep(200); }
      }
      // No exact match in the current listing: the target is probably nested
      // deeper than this dialog's starting directory. Leaving the dialog open
      // rather than guessing - logging tells us the real starting dir/depth
      // needed to extend this (e.g. drill into a parent match) next round.
    }
    localStorage.setItem('cc-ws-debug', JSON.stringify(dbg));
    console.error('[cc-ws-debug]', JSON.stringify(dbg));
    return;
  }

  // Keyboard fallback: type the folder basename to filter the dropdown
  console.log('[cc-ws] no direct match, trying keyboard fallback');
  await sleep(100);
  const name = folder.split('/').filter(Boolean).pop() || folder;
  const focused = document.activeElement;
  if (focused && focused !== document.body) {
    for (const ch of name) {
      const ev = {key: ch, bubbles: true, cancelable: true};
      focused.dispatchEvent(new KeyboardEvent('keydown', ev));
      focused.dispatchEvent(new KeyboardEvent('keypress', ev));
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
        focused.value += ch;
        focused.dispatchEvent(new Event('input', {bubbles: true}));
      }
      focused.dispatchEvent(new KeyboardEvent('keyup', ev));
      await sleep(40);
    }
    await sleep(250);
    const items2 = await waitNewMenu(800);
    console.log('[cc-ws] keyboard fallback items:', items2.map(i => i.textContent.trim()));
    const t2 = items2.find(el => matchFolder(el.textContent, folder));
    if (t2) { fireClick(t2); return; }
  }
  console.log('[cc-ws] giving up');
  document.body.click();
}

// A project row: oversized emoji + name, or emoji alone when the caller asks
// for a compact tile. Compactness is decided by the caller (only the Local
// grid opts in) - deriving it from emojiOnly() here used to make emoji-less
// folders render a full-width named row inside the dense wrap grid, which
// forced one item per line.
function makeFolderBtn(conn, folder, wsRow, opts = {}) {
  const raw = folder.split('/').filter(Boolean).pop() || folder;
  const {emoji, text} = splitEmoji(raw);
  const compact = !!(opts.compact && emoji);

  const b = document.createElement('button');
  b.type = 'button';
  b.title = folder;
  // Slightly taller than it needs to be on purpose: these are 11px rows in a
  // dense grid, and an extra pixel of padding is the difference between hitting
  // the project you meant and the one below it.
  b.style.cssText = 'box-sizing:border-box;display:flex;align-items:center;gap:5px;text-align:left;' +
    'border:0;border-radius:4px;background:transparent;color:inherit;' +
    'font:inherit;font-size:11px;cursor:pointer;' +
    (compact
      // A real square, so the hit target matches the glyph you can see.
      ? 'padding:0;width:' + TILE_PX + 'px;height:' + TILE_PX + 'px;flex:none;justify-content:center;'
      : 'padding:3px 6px;line-height:1.6;width:100%;');

  if (emoji) {
    const e = document.createElement('span');
    e.style.cssText = compact ? TILE_CSS : EMOJI_CSS;
    e.textContent = emoji;
    b.appendChild(e);
  }
  if (!compact) {
    const t = document.createElement('span');
    t.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    t.textContent = emoji ? text : raw;
    b.appendChild(t);
  }

  b.onmouseenter = () => { b.style.background = 'var(--bg-200,rgba(128,128,128,.15))'; };
  b.onmouseleave = () => { b.style.background = 'transparent'; };
  b.onclick = e => { e.stopPropagation(); clickWorkspace(conn, folder, wsRow); };
  // Right-click forgets a recorded entry. Only offered where it does something:
  // the Local list comes from cc-folders.json, so removing it from cc-ws-v4
  // wouldn't make the tile disappear. No confirm dialog - the entry re-records
  // itself the next time the workspace is actually used.
  if (opts.removable) {
    b.title = folder + '  (right-click to forget)';
    b.oncontextmenu = e => {
      e.preventDefault();
      e.stopPropagation();
      forgetWS(conn, folder);
    };
  }
  // TODO preview works for any folder we have baked/live text for, not just
  // Local - if a future data source ever populates ccTodo() for remote paths
  // (e.g. a remote fetch), the hover just starts working. Today
  // __CC_TODOS__/CC_AI_TODOS are only populated for Local (cc-ai-data-v2 reads
  // the local filesystem - see update-ui.sh), so remote entries fall through
  // to "No TODO.md". Hooked up unconditionally so a folder without one clears
  // the pane instead of leaving the previous project's list sitting there.
  b.addEventListener('mouseenter', () => showTodoPreview(folder));
  return b;
}

function colHeader(label) {
  const hdr = document.createElement('div');
  hdr.style.cssText = 'font-size:10px;font-weight:600;opacity:.5;text-transform:uppercase;' +
    'letter-spacing:.05em;margin-bottom:4px;padding:0 2px;';
  hdr.textContent = label;
  return hdr;
}

// `compact` = emoji-only tiles. Folders with no leading emoji have nothing to
// show as a tile, so they're dropped from the grid entirely rather than
// rendered as a full-width named row (which broke the wrap layout).
function folderGrid(conn, folders, wsRow, opts = {}) {
  const grid = document.createElement('div');
  // Emoji-only tiles are tiny, so pack them densely; named rows get 2 columns
  // once the list is long enough to be worth splitting.
  if (opts.compact) {
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;';
    folders = folders.filter(f => splitEmoji(f.split('/').filter(Boolean).pop() || f).emoji);
  } else if (folders.length > 4) {
    // minmax(0,1fr), not 1fr. A grid item defaults to min-width:auto, so it
    // refuses to shrink below its content and overflows its track instead -
    // which is how the Local column's second column ended up painted 96px into
    // the Remote column. Measured on the real folder list: 14 of 25 rows spilled.
    grid.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 6px;';
  }
  for (const folder of folders) grid.appendChild(makeFolderBtn(conn, folder, wsRow, opts));
  return grid;
}

function buildColumn(conn, folders, wsRow) {
  const col = document.createElement('div');
  col.style.cssText = 'flex:1;min-width:0;';
  col.appendChild(colHeader(conn));
  // If emoji-only filtering would empty the column, show the full list instead
  // of nothing.
  const compact = emojiOnly() &&
    folders.some(f => splitEmoji(f.split('/').filter(Boolean).pop() || f).emoji);
  if (!folders.length) {
    const hint = document.createElement('div');
    hint.textContent = 'No projects found';
    hint.style.cssText = 'font-size:10px;opacity:.35;padding:2px 4px;';
    col.appendChild(hint);
  } else {
    col.appendChild(folderGrid(conn, folders, wsRow, {compact}));
  }
  return col;
}

// All non-Local connections share ONE column, each host a small subheading -
// a separate column per host wastes horizontal space when most hosts only
// have a folder or two. Remote folders are never compacted: they're server
// paths (/root/000_myagents/...) with no emoji convention, so an emoji-only
// remote column would be empty. They're also the only removable entries -
// they come from cc-ws-v4, not from the baked folder list.
function buildRemoteColumn(groups, wsRow) {
  const col = document.createElement('div');
  col.style.cssText = 'flex:1;min-width:0;';
  col.appendChild(colHeader('Remote'));
  const hosts = Object.keys(groups).sort();
  if (!hosts.length) {
    const hint = document.createElement('div');
    hint.textContent = 'No remote folders yet';
    hint.style.cssText = 'font-size:10px;opacity:.35;padding:2px 4px;';
    col.appendChild(hint);
    return col;
  }
  for (const host of hosts) {
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:9px;font-weight:600;opacity:.4;margin:4px 0 1px;padding:0 2px;';
    sub.textContent = host;
    col.appendChild(sub);
    col.appendChild(folderGrid(host, groups[host], wsRow, {removable: true}));
  }
  return col;
}

// Safe markdown → DOM renderer for TODO preview. No innerHTML - XSS-safe.
function _mdInline(parent, text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g);
  for (const p of parts) {
    if (!p) continue;
    if (/^\*\*[^*]+\*\*$/.test(p)) {
      const b = document.createElement('strong'); b.textContent = p.slice(2, -2); parent.appendChild(b);
    } else if (/^\*[^*]+\*$/.test(p)) {
      const i = document.createElement('em'); i.textContent = p.slice(1, -1); parent.appendChild(i);
    } else if (/^_[^_]+_$/.test(p)) {
      const i = document.createElement('em'); i.textContent = p.slice(1, -1); parent.appendChild(i);
    } else if (/^`[^`]+`$/.test(p)) {
      const c = document.createElement('code');
      c.style.cssText = 'font-family:monospace;font-size:10px;background:rgba(128,128,128,.18);padding:0 3px;border-radius:3px;';
      c.textContent = p.slice(1, -1); parent.appendChild(c);
    } else {
      parent.appendChild(document.createTextNode(p));
    }
  }
}

function renderMarkdownInto(el, text) {
  el.textContent = '';
  let list = null;
  const endList = () => { list = null; };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { endList(); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (h) {
      endList();
      const lvl = h[1].length;
      const hd = document.createElement('div');
      hd.style.cssText = `font-weight:700;margin:6px 0 2px;font-size:${lvl <= 1 ? 12 : 11}px;opacity:.9;`;
      _mdInline(hd, h[2]); el.appendChild(hd);
    } else if (task) {
      if (!list) { list = document.createElement('div'); el.appendChild(list); }
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:5px;align-items:baseline;';
      const box = document.createElement('span');
      box.textContent = /x/i.test(task[1]) ? '☑' : '☐';
      box.style.opacity = '.8';
      const txt = document.createElement('span');
      if (/x/i.test(task[1])) txt.style.cssText = 'opacity:.55;text-decoration:line-through;';
      _mdInline(txt, task[2]);
      row.appendChild(box); row.appendChild(txt); list.appendChild(row);
    } else if (bullet || num) {
      if (!list) { list = document.createElement('div'); el.appendChild(list); }
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:5px;align-items:baseline;';
      const dot = document.createElement('span'); dot.textContent = '•'; dot.style.opacity = '.6';
      const txt = document.createElement('span');
      _mdInline(txt, (bullet || num)[1]);
      row.appendChild(dot); row.appendChild(txt); list.appendChild(row);
    } else if (quote) {
      endList();
      const q = document.createElement('div');
      q.style.cssText = 'border-left:2px solid var(--claude-border,rgba(128,128,128,.4));' +
        'padding-left:6px;margin:2px 0;opacity:.75;';
      _mdInline(q, quote[1]);
      el.appendChild(q);
    } else {
      endList();
      const p = document.createElement('div');
      p.style.margin = '2px 0';
      _mdInline(p, line);
      el.appendChild(p);
    }
  }
}


// ─────────────────────────────────────────────────────────────
//  PANEL SHELL + GEOMETRY
//
//  The panel used to be one absolutely-positioned box, anchored
//  `bottom:calc(100% + 6px)` on the workspace row, whose height was whatever
//  its contents happened to be. Both of the things that made it unusable came
//  straight out of that:
//
//   - Jitter. The TODO preview sat UNDER the project rows inside a
//     bottom-anchored box, so previewing a long TODO grew the box downward-
//     resistant top edge, i.e. it pushed every project row upward. Moving the
//     rows out from under the cursor swaps which project is hovered, which
//     swaps the preview, which moves the rows again. Hovering a list and having
//     it walk away is exactly that feedback loop.
//   - Cropping at zoom. Height was clamped to the space above the row. Browser
//     zoom shrinks the viewport in CSS pixels, so that space collapses and the
//     panel became a scrolling sliver.
//
//  Both are geometry problems, not content problems, so the fix is geometry:
//  the panel is now a FIXED-size box (width and height computed from the
//  viewport, never from its contents) with two independently-scrolling panes.
//  Hovering a project repaints the preview pane and changes nothing else on
//  screen. When there genuinely isn't room above the row, it stops trying to
//  fit there and anchors to the viewport instead.
// ─────────────────────────────────────────────────────────────
const WS_MARGIN   = 12;   // keep-out from every viewport edge
const WS_GAP      = 6;    // gap between the panel and the workspace row
const WS_TARGET_W = 760;
const WS_TARGET_H = 330;
const WS_MIN_H    = 210;  // below this, anchoring above the row isn't worth it
const WS_PREV_W   = 290;  // TODO preview pane
const WS_STACK_W  = 470;  // narrower than this, stack the panes instead

const COLLAPSE_KEY = 'cc-ws-collapsed';
const wsCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } };
const setWsCollapsed = v => { try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch {} };

let _prevTitle = null, _prevBody = null, _prevEdit = null, _prevBar = null;
let _prevFolder = null;   // which folder the preview is currently showing
let _editing = false;
let _saveTimer = null;

// Rendered view and edit view are two elements in the same slot, so switching
// between them can't change the pane's geometry (the whole point of #22).
function setEditing(on) {
  if (!_prevBody) return;
  _editing = !!on && !!_prevFolder;
  _prevBody.style.display = _editing ? 'none' : '';
  _prevEdit.style.display = _editing ? '' : 'none';
  _prevBar.editBtn.textContent = _editing ? 'done' : 'edit';
  _prevBar.editBtn.title = _editing ? 'Stop editing (changes save as you type)' : 'Edit this TODO.md';
  if (_editing) {
    _prevEdit.value = ccTodo(_prevFolder) || '';
    _prevEdit.focus();
  }
}

function setSaveState(msg, bad) {
  if (!_prevBar) return;
  _prevBar.status.textContent = msg || '';
  _prevBar.status.style.color = bad ? '#ef4444' : 'inherit';
}

// Writes through ccBridge.writeTodo -> cc-write-todo ipcMain handler, which is
// the only process with fs access. Debounced: this fires on every keystroke.
function saveTodoSoon() {
  if (!_prevFolder) return;
  const folder = _prevFolder, text = _prevEdit.value;
  setSaveState('…');
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    if (!window.ccBridge || typeof window.ccBridge.writeTodo !== 'function') {
      setSaveState('no bridge', true);
      return;
    }
    try {
      const r = await window.ccBridge.writeTodo(folder, text);
      if (r && r.ok) {
        // Keep the in-memory copy in step so hovering away and back, or
        // re-rendering the panel, doesn't resurrect the pre-edit text.
        if (typeof window.__CC_TODOS__ !== 'object' || !window.__CC_TODOS__) window.__CC_TODOS__ = {};
        window.__CC_TODOS__[folder] = text;
        setSaveState('saved');
        setTimeout(() => { if (_prevBar && _prevBar.status.textContent === 'saved') setSaveState(''); }, 1500);
      } else {
        setSaveState((r && r.error) ? String(r.error).slice(0, 40) : 'save failed', true);
      }
    } catch (e) {
      setSaveState('save failed', true);
      console.error('[cc-ws] writeTodo', e);
    }
  }, 600);
}

function showTodoPreview(folder) {
  if (!_prevTitle || !_prevBody) return;
  // Don't yank the pane out from under an in-progress edit just because the
  // pointer crossed another project on its way to the textarea.
  if (_editing && folder !== _prevFolder) return;
  _prevFolder = folder;
  const name = emojiSuffix(folder.split('/').filter(Boolean).pop() || folder);
  const text = ccTodo(folder);
  _prevTitle.textContent = name + ' - TODO.md';
  // The pane keeps its scroll offset between projects; without this a long
  // previous TODO leaves the next one already scrolled past its own heading.
  _prevBody.scrollTop = 0;
  if (text) renderMarkdownInto(_prevBody, text);
  else _prevBody.textContent = 'No TODO.md in this folder.';
  if (_prevBar) {
    _prevBar.editBtn.style.display = '';
    _prevBar.openBtn.style.display = '';
    setSaveState('');
  }
}

// Builds the static chrome once. rebuildPanel() only ever refills `list`, so
// the box itself never gets torn down and rebuilt under the cursor.
function buildShell(panel) {
  const head = document.createElement('div');
  head.style.cssText = 'flex:none;display:flex;align-items:center;gap:8px;' +
    'font-size:10px;font-weight:600;opacity:.55;text-transform:uppercase;' +
    'letter-spacing:.05em;margin-bottom:6px;';

  const htitle = document.createElement('span');
  htitle.textContent = 'Projects';
  htitle.style.cssText = 'flex:1;min-width:0;';
  head.appendChild(htitle);

  const toggle = document.createElement('label');
  toggle.style.cssText = 'display:flex;align-items:center;gap:4px;flex:none;cursor:pointer;' +
    'font-size:9px;font-weight:600;opacity:.75;text-transform:none;letter-spacing:0;';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = emojiOnly();
  cb.style.cssText = 'margin:0;cursor:pointer;';
  cb.onclick = e => e.stopPropagation();
  cb.onchange = () => { setEmojiOnly(cb.checked); rebuildPanel(); };
  toggle.appendChild(cb);
  toggle.appendChild(document.createTextNode('emoji only'));
  toggle.onclick = e => e.stopPropagation();
  head.appendChild(toggle);

  // Collapse exists for the zoomed-in case: at 150%+ the panel legitimately
  // covers most of the window, and you want it out of the way between uses.
  const coll = document.createElement('button');
  coll.type = 'button';
  coll.style.cssText = 'flex:none;border:0;background:transparent;color:inherit;' +
    'cursor:pointer;font:inherit;font-size:11px;line-height:1;padding:2px 4px;opacity:.8;';
  coll.onclick = e => {
    e.stopPropagation();
    setWsCollapsed(!wsCollapsed());
    applyCollapsed(panel);
    clampPanel(panel);
  };
  head.appendChild(coll);

  const body = document.createElement('div');
  body.style.cssText = 'flex:1;display:flex;gap:8px;min-height:0;min-width:0;';

  const list = document.createElement('div');
  list.style.cssText = 'flex:1 1 auto;min-width:0;overflow:auto;';

  const prev = document.createElement('div');
  prev.style.cssText = 'flex:none;display:flex;flex-direction:column;min-height:0;min-width:0;';

  const phead = document.createElement('div');
  phead.style.cssText = 'flex:none;display:flex;align-items:baseline;gap:6px;margin-bottom:4px;';

  const ptitle = document.createElement('div');
  ptitle.style.cssText = 'flex:1;min-width:0;font-size:10px;font-weight:600;opacity:.55;' +
    'text-transform:uppercase;letter-spacing:.05em;' +
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

  const pstatus = document.createElement('span');
  pstatus.style.cssText = 'flex:none;font-size:9px;opacity:.6;min-width:30px;text-align:right;';

  const mkAction = (label, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.style.cssText = 'flex:none;border:0;background:transparent;color:inherit;cursor:pointer;' +
      'font:inherit;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;' +
      'opacity:.7;padding:1px 3px;border-radius:3px;';
    b.onmouseenter = () => { b.style.background = 'var(--bg-200,rgba(128,128,128,.18))'; };
    b.onmouseleave = () => { b.style.background = 'transparent'; };
    return b;
  };

  const editBtn = mkAction('edit', 'Edit this TODO.md');
  editBtn.onclick = e => { e.stopPropagation(); setEditing(!_editing); };
  // The one-click "open the folder" the panel was missing: ccBridge.openFolder
  // already existed for this, wired to shell.openPath in the main process.
  const openBtn = mkAction('open', 'Open this folder in the file manager');
  openBtn.onclick = e => {
    e.stopPropagation();
    if (_prevFolder && window.ccBridge?.openFolder) window.ccBridge.openFolder(_prevFolder);
  };

  phead.appendChild(ptitle);
  phead.appendChild(pstatus);
  phead.appendChild(editBtn);
  phead.appendChild(openBtn);

  const pbody = document.createElement('div');
  pbody.style.cssText = 'flex:1;min-height:0;overflow:auto;font-size:11px;line-height:1.4;' +
    'word-break:break-word;opacity:.85;font-family:inherit;';

  const pedit = document.createElement('textarea');
  pedit.spellcheck = false;
  pedit.style.cssText = 'display:none;box-sizing:border-box;flex:1;min-height:0;width:100%;' +
    'resize:none;border:1px solid var(--claude-border,rgba(128,128,128,.35));border-radius:5px;' +
    'padding:6px;background:rgba(255,255,255,.35);color:inherit;' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.45;';
  pedit.oninput = saveTodoSoon;
  // Keystrokes inside the panel must not reach the app underneath - Claude
  // binds single-key shortcuts on the document, and typing "n" into a TODO
  // should not start a new chat.
  for (const ev of ['keydown', 'keyup', 'keypress']) {
    pedit.addEventListener(ev, e => {
      e.stopPropagation();
      if (e.key === 'Escape') { setEditing(false); showTodoPreview(_prevFolder); }
    });
  }

  prev.appendChild(phead);
  prev.appendChild(pbody);
  prev.appendChild(pedit);
  _prevEdit = pedit;
  _prevBar = {wrap: phead, status: pstatus, editBtn, openBtn};
  body.appendChild(list);
  body.appendChild(prev);
  panel.appendChild(head);
  panel.appendChild(body);

  panel._els = {head, htitle, coll, body, list, prev, phead, ptitle, pbody, pedit};
  _prevTitle = ptitle;
  _prevBody = pbody;
  applyCollapsed(panel);
}

function applyCollapsed(panel) {
  const c = wsCollapsed();
  panel._els.body.style.display = c ? 'none' : 'flex';
  panel._els.head.style.marginBottom = c ? '0' : '6px';
  panel._els.coll.textContent = c ? '▸' : '▾';
  panel._els.coll.title = c ? 'Expand project panel' : 'Collapse project panel';
}

function rebuildPanel() {
  const panel = document.querySelector('.' + PANEL_CLS);
  if (!panel?._wsRow || !panel._els) return;
  const ws = loadWS();
  const L = (typeof window.__CC_FOLDERS__ !== 'undefined' && window.__CC_FOLDERS__.length) ? window.__CC_FOLDERS__
    : (typeof CC_AI_LOCAL !== 'undefined') ? CC_AI_LOCAL
    : [...new Set(ws.filter(w => w.conn === 'Local').map(w => w.folder))];
  // Every non-Local connection we've ever recorded, grouped by host name -
  // no longer hardcoded to "Myserver".
  const remote = {};
  for (const {conn, folder} of ws) {
    if (!conn || conn === 'Local') continue;
    (remote[conn] ||= []);
    if (!remote[conn].includes(folder)) remote[conn].push(folder);
  }

  const list = panel._els.list;
  list.textContent = '';
  const cols = document.createElement('div');
  cols.style.cssText = 'display:flex;gap:8px;align-items:flex-start;';
  cols.appendChild(buildColumn('Local', L, panel._wsRow));
  cols.appendChild(buildRemoteColumn(remote, panel._wsRow));
  list.appendChild(cols);

  const seed = _prevFolder || L.find(f => ccTodo(f));
  if (seed) showTodoPreview(seed);
  else {
    _prevFolder = null;
    _prevTitle.textContent = 'TODO.md';
    _prevBody.textContent = 'Hover a project to preview its TODO.md';
    // Nothing to edit or open yet, so don't offer to.
    if (_prevBar) { _prevBar.editBtn.style.display = 'none'; _prevBar.openBtn.style.display = 'none'; }
  }

  clampPanel(panel);
}

function removeAllPanels() {
  document.querySelectorAll('.' + PANEL_CLS).forEach(p => p.remove());
  _prevTitle = _prevBody = null;
}

// The panel now lives on document.body (see installPanel), so nothing removes
// it automatically when its row goes away. Called from the scan loop.
function prunePanels() {
  document.querySelectorAll('.' + PANEL_CLS).forEach(p => {
    if (!p._wsRow || !p._wsRow.isConnected) { p.remove(); _prevTitle = _prevBody = null; }
    else clampPanel(p);
  });
}

function installPanel(wsRow) {
  if (wsRow.dataset.ccRow) return;
  wsRow.dataset.ccRow = '1';
  wsRow.addEventListener('click', () => sampleWS(wsRow), true);
  if (location.pathname.includes('/chat/')) return;
  if (document.querySelector('.' + PANEL_CLS)) return;

  const panel = document.createElement('div');
  panel.className = PANEL_CLS;
  panel._wsRow = wsRow;
  // position:fixed, and parented to <body> rather than to the row. An
  // absolutely-positioned child inherits its containing block from the nearest
  // positioned/transformed ancestor, and claude.ai wraps this row in animated
  // containers - one `transform` anywhere up the tree silently redefines what
  // "fixed" means. Off the row, off the problem.
  //
  // Sepia rather than near-white: monochrome emoji (☑ ⏱ ✂ …) disappear against
  // #faf9f5 but read clearly against a warm ground.
  // box-sizing is explicit because clampPanel sets width/height outright: with
  // the default content-box the 12px padding and 1px border land OUTSIDE the
  // computed size, so the box quietly renders 26px wider than the viewport fit
  // it was just given.
  panel.style.cssText = 'box-sizing:border-box;position:fixed;z-index:2147482000;display:flex;flex-direction:column;' +
    'background:#f2e8d5;' +
    'border:1px solid var(--claude-border,rgba(128,128,128,.22));' +
    'border-radius:8px;padding:10px 12px;' +
    'box-shadow:0 4px 20px rgba(0,0,0,.16);font-family:inherit;color:inherit;' +
    'overflow:hidden;';  // panes scroll, the box never does
  document.body.appendChild(panel);
  buildShell(panel);
  rebuildPanel();
  installClampListeners();
}

// Zoom and window resize both move the row and change the viewport. Coalesced
// to one clamp per frame across every panel.
let _clampListeners = false;
let _clampRaf = 0;
function scheduleClamp() {
  if (_clampRaf) return;
  _clampRaf = requestAnimationFrame(() => {
    _clampRaf = 0;
    document.querySelectorAll('.' + PANEL_CLS).forEach(clampPanel);
  });
}
function installClampListeners() {
  if (_clampListeners) return;
  _clampListeners = true;
  window.addEventListener('resize', scheduleClamp);
  window.visualViewport?.addEventListener('resize', scheduleClamp);
  window.visualViewport?.addEventListener('scroll', scheduleClamp);
}

// Sets width/height/top/left outright every time. Nothing here reads the
// panel's content size, so hovering a project can never move the box.
function clampPanel(panel) {
  if (!panel?.isConnected || !panel._els) return;
  const row = panel._wsRow;
  if (!row?.isConnected) { panel.remove(); _prevTitle = _prevBody = null; return; }

  const rr = row.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.max(240, Math.min(WS_TARGET_W, vw - 2 * WS_MARGIN));

  let left = Math.round(rr.left);
  if (left + w > vw - WS_MARGIN) left = vw - WS_MARGIN - w;
  if (left < WS_MARGIN) left = WS_MARGIN;

  panel.style.width = w + 'px';
  panel.style.left = left + 'px';

  if (wsCollapsed()) {
    // Height follows the single head row; measure after clearing the override.
    panel.style.height = 'auto';
    const h = panel.offsetHeight || 30;
    let top = Math.round(rr.top) - WS_GAP - h;
    if (top < WS_MARGIN) top = Math.max(WS_MARGIN, Math.min(vh - WS_MARGIN - h, Math.round(rr.bottom) + WS_GAP));
    panel.style.top = top + 'px';
    return;
  }

  const above = Math.round(rr.top) - WS_GAP - WS_MARGIN;
  let h, top;
  if (above >= WS_MIN_H) {
    h = Math.min(WS_TARGET_H, above);
    top = Math.round(rr.top) - WS_GAP - h;
  } else {
    // Not enough headroom - browser zoom, or a short window. Squeezing into a
    // 60px sliver is what made it useless; anchor to the viewport and accept
    // overlapping the row. The collapse chevron is the way out.
    h = Math.min(WS_TARGET_H, vh - 2 * WS_MARGIN);
    top = WS_MARGIN;
  }
  panel.style.height = h + 'px';
  panel.style.top = top + 'px';

  // Side-by-side needs real width for both panes; below that, stack them so
  // the preview stays reachable instead of being dropped. Either way both
  // dimensions are fixed, so the layout is stable under hover.
  const {body, list, prev} = panel._els;
  if (w >= WS_STACK_W) {
    body.style.flexDirection = 'row';
    prev.style.width = WS_PREV_W + 'px';
    prev.style.height = '';
    prev.style.borderLeft = '1px solid var(--claude-border,rgba(128,128,128,.22))';
    prev.style.borderTop = '';
    prev.style.paddingLeft = '8px';
    prev.style.paddingTop = '';
    list.style.maxHeight = '';
  } else {
    body.style.flexDirection = 'column';
    prev.style.width = 'auto';
    prev.style.height = Math.round(h * 0.42) + 'px';
    prev.style.borderLeft = '';
    prev.style.borderTop = '1px solid var(--claude-border,rgba(128,128,128,.22))';
    prev.style.paddingLeft = '';
    prev.style.paddingTop = '6px';
    list.style.maxHeight = '';
  }
}

// ─────────────────────────────────────────────────────────────
//  USAGE READOUT
//  Live 5-hour / weekly plan usage + context window, in a fixed corner chip.
//
//  The old (2026-07, deleted) usage badges scraped the usage popover's text.
//  That could never be live: the numbers only exist in the DOM while the
//  popover is open, so the badge showed whatever it last happened to see, and
//  the attempt to fix that by auto-opening the popover on a timer is what broke
//  the effort picker (issues-fixed #13). This version does not read the DOM for
//  plan usage at all.
//
//  Source: the app's OWN endpoint.
//    GET /api/organizations/<org>/usage
//      → { five_hour:            {utilization, resets_at},
//          seven_day:            {...},   seven_day_opus:      {...},
//          seven_day_sonnet:     {...},   seven_day_oauth_apps:{...},
//          seven_day_cowork:     {...},   seven_day_omelette:  {...},
//          omelette_promotional: {...},
//          extra_usage: {is_enabled, monthly_limit, used_credits, utilization} }
//
//  Confirmed by reading the main-process bundle's tray-usage code (search
//  `[plan-usage]` in .vite/build/index.chunk-*.js): it hits exactly this URL
//  with `net.fetch` on the default session, on a 300s timer. The renderer
//  shares that session, so a same-origin credentialed fetch sees the same data.
//  `utilization` is 0-100. `resets_at` is an ISO timestamp - which is why
//  nothing on this path has to parse "Resets Wed 1:39 AM". That parsing was the
//  old badge's other failure mode; parseResetText() below survives only as a
//  fallback for the DOM-scraped context figure.
//
//  Debug from DevTools: window.__ccUsage()
// ─────────────────────────────────────────────────────────────

const CU_ORG_KEY   = 'cc-usage-org';     // cached organization uuid
const CU_SNAP_KEY  = 'cc-usage-snap';    // last payload, so a cold start shows something
const CU_POS_KEY   = 'cc-usage-corner';  // which corner the chip sits in
const CU_PROBE_KEY = 'cc-usage-probe';   // '1' = log candidate context payloads

const CU_POLL_MS   = 60000;   // steady-state refresh (the app itself uses 300s)
const CU_TICK_MS   = 20000;   // re-render cadence, so "resets in" counts down
const CU_STALE_MS  = 15 * 60000;

const CU_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// [key, long label, short label]. Order is the order they appear in the card.
// Kept in sync with the bundle's own bucket list; unknown keys in the payload
// are ignored rather than guessed at, and buckets the account doesn't have
// come back null and are skipped.
const CU_BUCKETS = [
  ['five_hour',            '5-hour limit',           '5h'],
  ['seven_day',            'Weekly · all models',    'wk'],
  ['seven_day_opus',       'Weekly · Opus',          'opus'],
  ['seven_day_sonnet',     'Weekly · Sonnet',        'sonnet'],
  ['seven_day_oauth_apps', 'Weekly · Claude Code',   'code'],
  ['seven_day_cowork',     'Weekly · Cowork',        'cowork'],
  ['seven_day_omelette',   'Weekly · Claude Design', 'design'],
  ['omelette_promotional', 'Claude Design grant',    'grant'],
];

// The three the chip itself shows, left to right.
const CU_CHIP = ['ctx', 'five_hour', 'seven_day'];

let cuPlan     = null;   // last parsed /usage payload
let cuPlanAt   = 0;      // when we got it
let cuCtx      = null;   // {pct, used, total, at} - context window, DOM/network sourced
let cuOrg      = null;
let cuFailures = 0;
let cuTimer    = null;

// ── formatting ──────────────────────────────────────────────────────────────

// 4h12m / 45m / 2d 3h. Single-unit above a day would round "6d 23h" to "6d",
// which reads as a whole day of slack that isn't there.
function cuFmtIn(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return min + 'm';
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? h + 'h' + m + 'm' : h + 'h';
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? d + 'd ' + rh + 'h' : d + 'd';
}

function cuPct(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// Each bucket keeps its own hue so the chip can drop its text labels and still
// be readable at a glance, and severity overrides the hue once a number is
// actually worth reacting to. Colouring 30% orange just trains you to ignore
// the colour, so nothing warns below 60.
const CU_HUE = {ctx: '#3b82f6', five_hour: '#d97706', seven_day: '#16a34a'};
function cuColor(pct, key) {
  if (pct == null) return 'var(--cc-u-dim)';
  if (pct >= 95) return '#ef4444';
  if (pct >= 80) return '#f97316';
  if (pct >= 60) return '#eab308';
  return (key && CU_HUE[key]) || 'var(--cc-u-fg)';
}

// ── reset-time parsing (fallback only) ──────────────────────────────────────
//
// The API path never needs this - resets_at is ISO. It exists for text scraped
// out of the UI, where the wording has changed at least three times already
// ("Resets Wed 9:59 AM" → "Resets Jun 24" → "resets 59m"). Rather than chase
// each new spelling, try every shape the app and claude.ai have been observed
// to use, plus the obvious neighbours, and take the first that parses.
//
// Returns an absolute ms timestamp, or null.
const CU_DOW    = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const CU_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                   'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "3", "3:15", "3:15 pm", "15:15" → {h, m} in 24h, or null.
function cuClock(hStr, mStr, ampm) {
  let h = +hStr;
  const m = mStr ? +mStr : 0;
  if (!Number.isFinite(h) || h > 23 || m > 59) return null;
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  return {h, m};
}

// Next wall-clock occurrence of h:m, optionally on a named weekday.
function cuNextAt(h, m, dayHint, now) {
  const t = new Date(now);
  t.setHours(h, m, 0, 0);
  const d = (dayHint || '').toLowerCase();
  if (!d || d === 'today') {
    if (t.getTime() <= now) t.setDate(t.getDate() + 1);
  } else if (d === 'tomorrow' || d === 'tmrw') {
    t.setDate(t.getDate() + 1);
  } else {
    const want = CU_DOW.findIndex(x => d.startsWith(x));
    if (want === -1) return null;
    let ahead = want - t.getDay();
    if (ahead < 0 || (ahead === 0 && t.getTime() <= now)) ahead += 7;
    t.setDate(t.getDate() + ahead);
  }
  return t.getTime();
}

// "2d 4h 30m", "45 minutes", "3 hrs" → milliseconds.
function cuDuration(str) {
  const re = /(\d+(?:\.\d+)?)\s*(d(?:ays?)?|h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)\b/gi;
  let total = 0, m;
  while ((m = re.exec(str))) {
    const n = parseFloat(m[1]), u = m[2][0].toLowerCase();
    total += n * (u === 'd' ? 86400000 : u === 'h' ? 3600000 : u === 'm' ? 60000 : 1000);
  }
  return total || null;
}

function parseResetText(str, now) {
  if (!str || typeof str !== 'string') return null;
  now = now || Date.now();
  const s = str.replace(/ /g, ' ').trim();
  let m;

  // 1. ISO 8601 / RFC 3339, with or without zone. What the API returns.
  m = s.match(/\b(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?)\b/);
  if (m) {
    const t = Date.parse(m[1].replace(' ', 'T'));
    if (Number.isFinite(t)) return t;
  }

  // 2. Epoch seconds/millis, in case a payload ever exposes one raw.
  m = s.match(/\b(1[0-9]{9}(?:[0-9]{3})?)\b/);
  if (m) {
    const n = +m[1];
    return n > 1e12 ? n : n * 1000;
  }

  // 3. Relative: "resets in 2h 15m", "in 45 minutes", "· resets 59m", "1h".
  //    Anchored on "resets"/"in" so a stray "5-hour" can't be read as a delta.
  m = s.match(/(?:resets?|refreshes?|renews?|available|back)\b[^0-9]{0,12}((?:\d+(?:\.\d+)?\s*(?:d|h|m|s|days?|hours?|hrs?|min(?:ute)?s?|sec(?:ond)?s?)\s*)+)/i)
   || s.match(/\bin\s+((?:\d+(?:\.\d+)?\s*(?:d|h|m|s|days?|hours?|hrs?|min(?:ute)?s?|sec(?:ond)?s?)\s*)+)/i);
  if (m) {
    const d = cuDuration(m[1]);
    if (d) return now + d;
  }

  // 4. Weekday/today/tomorrow + clock: "Resets Wed 1:39 AM", "resets tomorrow at 3pm".
  m = s.match(/(?:resets?|until|at)\b\s*(?:on\s+)?(today|tomorrow|tmrw|sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i);
  if (m) {
    const c = cuClock(m[2], m[3], m[4]);
    if (c) {
      const t = cuNextAt(c.h, c.m, m[1], now);
      if (t) return t;
    }
  }

  // 5. Weekday alone: "Resets Wednesday".
  m = s.match(/resets?\s+(?:on\s+)?(today|tomorrow|tmrw|sun|mon|tue|wed|thu|fri|sat)[a-z]*\b(?!\s*\d)/i);
  if (m) {
    const t = cuNextAt(0, 0, m[1], now);
    if (t) return t;
  }

  // 6. Month + day (+ optional year/clock): "Resets Jun 24", "Resets June 24 at 9:00 AM".
  m = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?(?:\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (m) {
    const mon = CU_MONTHS.indexOf(m[1].toLowerCase());
    const c = m[4] ? cuClock(m[4], m[5], m[6]) : {h: 0, m: 0};
    if (mon >= 0 && c) {
      const t = new Date(now);
      t.setMonth(mon, +m[2]);
      t.setHours(c.h, c.m, 0, 0);
      if (m[3]) t.setFullYear(+m[3]);
      else if (t.getTime() < now - 86400000) t.setFullYear(t.getFullYear() + 1);
      return t.getTime();
    }
  }

  // 7. Numeric date: "resets 6/24", "resets 24/06/2026". Ambiguous by locale,
  //    so resolve it the way the page would: read it in the browser's own order.
  m = s.match(/resets?\s+(?:on\s+)?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?/i);
  if (m) {
    const a = +m[1], b = +m[2];
    // Day-first if the first number can't be a month, or if the locale is.
    const dayFirst = a > 12 || !/^en-?US?$/i.test(navigator.language || 'en-US');
    const day = dayFirst ? a : b, mon = (dayFirst ? b : a) - 1;
    if (mon >= 0 && mon < 12 && day >= 1 && day <= 31) {
      const t = new Date(now);
      t.setMonth(mon, day);
      t.setHours(0, 0, 0, 0);
      if (m[3]) t.setFullYear(+m[3] < 100 ? 2000 + +m[3] : +m[3]);
      else if (t.getTime() < now - 86400000) t.setFullYear(t.getFullYear() + 1);
      return t.getTime();
    }
  }

  // 8. Clock only: "Resets at 15:00", "resets at 3pm".
  m = s.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))\s*(am|pm)?|resets?\s+at\s+(\d{1,2})\s*(am|pm)/i);
  if (m) {
    const c = m[1] ? cuClock(m[1], m[2], m[3]) : cuClock(m[4], null, m[5]);
    if (c) return cuNextAt(c.h, c.m, null, now);
  }

  return null;
}

// ── org uuid ────────────────────────────────────────────────────────────────

// The main process reads this from the `lastActiveOrg` cookie. Try the same
// cookie first (it isn't HttpOnly in practice, but don't rely on that), then a
// cached value, then ask the API.
function cuCookieOrg() {
  try {
    for (const part of (document.cookie || '').split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() !== 'lastActiveOrg') continue;
      const m = decodeURIComponent(part.slice(eq + 1)).match(CU_UUID_RE);
      if (m) return m[0];
    }
  } catch (_) {}
  return null;
}

async function cuFetchJSON(path) {
  const r = await fetch(path, {
    credentials: 'include',
    headers: {accept: 'application/json'},
    cache: 'no-store',
  });
  if (!r.ok) {
    const e = new Error('HTTP ' + r.status);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

async function cuResolveOrg(force) {
  if (cuOrg && !force) return cuOrg;
  if (!force) {
    const cached = (() => { try { return localStorage.getItem(CU_ORG_KEY); } catch (_) { return null; } })();
    if (cached && CU_UUID_RE.test(cached)) { cuOrg = cached; return cuOrg; }
  }
  const fromCookie = cuCookieOrg();
  if (fromCookie) { cuOrg = fromCookie; }
  else {
    const orgs = await cuFetchJSON('/api/organizations');
    if (!Array.isArray(orgs) || !orgs.length) throw new Error('no organizations');
    // Prefer an org that can actually chat; some accounts carry API-only orgs.
    const pick = orgs.find(o => Array.isArray(o.capabilities) && o.capabilities.includes('chat')) || orgs[0];
    if (!pick || !CU_UUID_RE.test(pick.uuid || '')) throw new Error('no org uuid');
    cuOrg = pick.uuid;
  }
  try { localStorage.setItem(CU_ORG_KEY, cuOrg); } catch (_) {}
  return cuOrg;
}

// ── plan usage ──────────────────────────────────────────────────────────────

function cuStoreSnapshot() {
  try {
    localStorage.setItem(CU_SNAP_KEY, JSON.stringify({plan: cuPlan, at: cuPlanAt}));
  } catch (_) {}
}

function cuLoadSnapshot() {
  try {
    const d = JSON.parse(localStorage.getItem(CU_SNAP_KEY) || 'null');
    if (d && d.plan && typeof d.plan === 'object') { cuPlan = d.plan; cuPlanAt = d.at || 0; }
  } catch (_) {}
}

// Accepts a payload from either the poll or the fetch hook.
function cuAdoptPlan(data) {
  if (!data || typeof data !== 'object') return false;
  const known = CU_BUCKETS.some(([k]) => k in data);
  if (!known && !('extra_usage' in data)) return false;
  cuPlan = data;
  cuPlanAt = Date.now();
  cuFailures = 0;
  cuStoreSnapshot();
  cuRender();
  return true;
}

async function cuPoll() {
  if (document.hidden) return;
  try {
    const org = await cuResolveOrg(false);
    cuAdoptPlan(await cuFetchJSON('/api/organizations/' + org + '/usage'));
  } catch (e) {
    cuFailures++;
    // A stale cached org uuid (org switch, re-login) shows up as 401/403/404.
    // Drop it and let the next tick re-resolve from scratch, once.
    if (e && (e.status === 401 || e.status === 403 || e.status === 404)) {
      cuOrg = null;
      try { localStorage.removeItem(CU_ORG_KEY); } catch (_) {}
    }
    if (cuFailures === 1 || cuFailures % 10 === 0) {
      console.warn('[cc-usage] fetch failed (' + cuFailures + ')', e && e.message);
    }
    cuRender();
  }
}

function cuSchedule() {
  if (cuTimer) clearTimeout(cuTimer);
  // Back off on repeated failure so a logged-out window isn't hammering the
  // API every minute, but never past 10 minutes.
  const delay = Math.min(CU_POLL_MS * Math.max(1, Math.min(cuFailures, 10)), 600000);
  cuTimer = setTimeout(() => { cuPoll().finally(cuSchedule); }, delay);
}

// ── context window ──────────────────────────────────────────────────────────
//
// Unlike plan usage there is no endpoint for this: the context figure is
// computed client-side and only surfaces in the usage popover. So it is read
// from the DOM when it happens to be visible, and from any API payload that
// carries it (see cuNetProbe). It is deliberately NOT refreshed by opening the
// popover on a timer - that is what broke the effort picker last time.
function cuSetCtx(pct, used, total) {
  pct = cuPct(pct);
  if (pct == null && used != null && total) pct = cuPct(used / total * 100);
  if (pct == null) return;
  cuCtx = {pct, used: used ?? null, total: total ?? null, at: Date.now()};
  cuRender();
}

// "56.4k / 200.0k (28%)" and friends. Also plain "context 28%".
const CU_CTX_FRAC = /([\d.]+)\s*([km])?\s*\/\s*([\d.]+)\s*([km])?\s*(?:\((\d{1,3})%\))?/i;

function cuScale(n, suffix) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return null;
  const s = (suffix || '').toLowerCase();
  return s === 'm' ? v * 1e6 : s === 'k' ? v * 1e3 : v;
}

function cuScanContext() {
  // 1. Anything that labels itself. aria-label survived several redesigns as
  //    "Usage: context 28%, plan 7%" before context was dropped from it; if it
  //    ever comes back this picks it up for free.
  for (const el of document.querySelectorAll('[aria-label*="ontext" i]')) {
    const lbl = el.getAttribute('aria-label') || '';
    const p = lbl.match(/context[^%]{0,60}?(\d{1,3})\s*%/i);
    if (p) { cuSetCtx(+p[1]); return true; }
    const f = lbl.match(CU_CTX_FRAC);
    if (f) { cuSetCtx(f[5] ? +f[5] : null, cuScale(f[1], f[2]), cuScale(f[3], f[4])); return true; }
  }

  // 2. The usage popover, while it is open. Scoped to open overlay containers
  //    rather than document.body.innerText - a whole-body innerText read forces
  //    layout on every call, which is exactly the kind of thing that made the
  //    renderer unresponsive before (issues-fixed #3).
  const overlays = document.querySelectorAll(
    '[role="dialog"],[role="tooltip"],[data-state="open"],[data-radix-popper-content-wrapper]');
  for (const o of overlays) {
    if (!o.offsetParent && o.getClientRects().length === 0) continue;
    const t = o.innerText || '';
    if (!/context/i.test(t)) continue;
    const seg = t.slice(t.search(/context/i));
    const f = seg.match(CU_CTX_FRAC);
    if (f) { cuSetCtx(f[5] ? +f[5] : null, cuScale(f[1], f[2]), cuScale(f[3], f[4])); return true; }
    const p = seg.match(/(\d{1,3})\s*%/);
    if (p) { cuSetCtx(+p[1]); return true; }
  }
  return false;
}

// ── network hook ────────────────────────────────────────────────────────────
//
// Two jobs, both cheap:
//   - adopt any /usage response the app fetches for itself, so the numbers move
//     the instant the app's own tray refresh lands rather than on our timer;
//   - notice when a completion finishes and re-poll shortly after, since that
//     is the only moment usage actually changes.
// Response bodies are only read for URLs we already expect to be usage JSON.
// Everything else is a URL check and nothing more.
let cuBurst = null;
function cuBurstPoll() {
  if (cuBurst) return;
  // Usage is recomputed server-side a beat after the turn ends; one poll at 5s
  // and one at 25s covers it without turning every message into a poll storm.
  cuBurst = setTimeout(() => {
    cuBurst = null;
    cuPoll();
    setTimeout(cuPoll, 20000);
  }, 5000);
}

function cuProbeLog(url, body) {
  try {
    if (localStorage.getItem(CU_PROBE_KEY) !== '1') return;
    const keys = body && typeof body === 'object' ? Object.keys(body).slice(0, 40) : [];
    console.log('[cc-usage-probe]', url, keys);
  } catch (_) {}
}

function cuNetHook() {
  const orig = window.fetch;
  if (typeof orig !== 'function' || orig.__ccUsageHooked) return;
  const hooked = function (input, init) {
    const p = orig.apply(this, arguments);
    let url = '';
    try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (_) {}
    if (!url) return p;
    if (/\/usage(\?|$)/.test(url)) {
      p.then(res => {
        if (!res || !res.ok) return;
        res.clone().json().then(d => { cuProbeLog(url, d); cuAdoptPlan(d); }).catch(() => {});
      }).catch(() => {});
    } else if (/\/completion|\/retry_completion/.test(url)) {
      p.then(() => cuBurstPoll()).catch(() => {});
    }
    return p;
  };
  hooked.__ccUsageHooked = true;
  try { window.fetch = hooked; } catch (_) {}
}

// ── chip ────────────────────────────────────────────────────────────────────

const CU_CORNERS = ['br', 'bl', 'tr', 'tl'];

function cuCorner() {
  try {
    const v = localStorage.getItem(CU_POS_KEY);
    if (CU_CORNERS.includes(v)) return v;
  } catch (_) {}
  return 'br';
}

function cuInjectCSS() {
  if (document.getElementById('cc-usage-css')) return;
  const s = document.createElement('style');
  s.id = 'cc-usage-css';
  s.textContent = [
    ':root{--cc-u-bg:#f2e8d5;--cc-u-fg:#2b2418;--cc-u-dim:rgba(43,36,24,.42);--cc-u-line:rgba(0,0,0,.16);}',
    '@media (prefers-color-scheme:dark){:root{--cc-u-bg:#2e2919;--cc-u-fg:#ece5d5;--cc-u-dim:rgba(236,229,213,.42);--cc-u-line:rgba(255,255,255,.14);}}',
    // The wrapper spans the corner but must never eat clicks meant for the app;
    // only the chip itself is interactive.
    //
    // -webkit-app-region:no-drag is the whole reason the top corners work at
    // all. Electron marks the window's top strip as a drag region, and a drag
    // region swallows pointer events before they reach anything painted inside
    // it - which is why the chip went dead the moment it moved up there, and
    // why the app's own top-bar icons are awkward to hit. Opting this element
    // out puts clicks back.
    '#cc-usage{position:fixed;z-index:2147483000;pointer-events:none;font-family:inherit;' +
      'font-variant-numeric:tabular-nums;letter-spacing:-.01em;-webkit-app-region:no-drag;}',
    '#cc-usage[data-corner="br"]{right:12px;bottom:12px;}',
    '#cc-usage[data-corner="bl"]{left:12px;bottom:12px;}',
    // Top corners clear the app's own 44px top bar rather than sitting under it.
    '#cc-usage[data-corner="tr"]{right:12px;top:46px;}',
    '#cc-usage[data-corner="tl"]{left:12px;top:46px;}',
    '.cc-u-chip{pointer-events:auto;-webkit-app-region:no-drag;' +
      'display:inline-flex;align-items:center;gap:7px;' +
      'background:var(--cc-u-bg);color:var(--cc-u-fg);border:1px solid var(--cc-u-line);' +
      'border-radius:7px;padding:3px 8px;font-size:10.5px;line-height:1.5;cursor:pointer;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.14);opacity:.6;transition:opacity .12s;user-select:none;}',
    '#cc-usage:hover .cc-u-chip{opacity:1;}',
    // Attached mode: inline inside the app's own composer footer, no card of
    // its own, inheriting the row's sizing.
    '.cc-u-chip.attached{background:transparent;border:0;box-shadow:none;opacity:.9;padding:0 4px;}',
    '.cc-u-chip .v{font-weight:700;}',
    '.cc-u-chip .r{opacity:.45;font-size:9.5px;}',
    '.cc-u-chip .sep{opacity:.25;}',
    '.cc-u-card{pointer-events:none;display:none;position:absolute;min-width:230px;' +
      'background:var(--cc-u-bg);color:var(--cc-u-fg);border:1px solid var(--cc-u-line);' +
      'border-radius:8px;padding:8px 10px;font-size:11px;line-height:1.5;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.22);}',
    '#cc-usage:hover .cc-u-card{display:block;}',
    '#cc-usage[data-corner="br"] .cc-u-card,#cc-usage[data-corner="bl"] .cc-u-card{bottom:calc(100% + 6px);}',
    '#cc-usage[data-corner="tr"] .cc-u-card,#cc-usage[data-corner="tl"] .cc-u-card{top:calc(100% + 6px);}',
    '#cc-usage[data-corner="br"] .cc-u-card,#cc-usage[data-corner="tr"] .cc-u-card{right:0;}',
    '#cc-usage[data-corner="bl"] .cc-u-card,#cc-usage[data-corner="tl"] .cc-u-card{left:0;}',
    '.cc-u-row{display:flex;align-items:baseline;gap:8px;}',
    '.cc-u-row .l{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.8;}',
    '.cc-u-bar{height:3px;border-radius:2px;background:var(--cc-u-line);margin:1px 0 4px;overflow:hidden;}',
    '.cc-u-bar>i{display:block;height:100%;border-radius:2px;}',
    '.cc-u-foot{margin-top:5px;padding-top:4px;border-top:1px solid var(--cc-u-line);' +
      'font-size:9.5px;opacity:.5;}',
  ].join('\n');
  document.head.appendChild(s);
}

let cuRoot = null, cuChipEl = null, cuCardEl = null, cuNative = null;

// The app's own usage control - the little circular tracker next to the model
// name in the composer footer. Found by aria-label, never by class name or
// position, and guarded to icon-button dimensions so a redesign that reuses the
// word "usage" on a big container can't get its icon hidden (issues-fixed #18).
function cuFindNative() {
  if (cuNative && cuNative.isConnected) return cuNative;
  cuNative = null;
  const cands = document.querySelectorAll(
    'button[aria-label*="usage" i],button[aria-label*="Usage" i],' +
    'button[aria-label*="limit" i],button[aria-label*="plan" i]');
  for (const b of cands) {
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.width > 90 || r.height > 60) continue;
    cuNative = b;
    break;
  }
  return cuNative;
}

function cuCycleCorner() {
  const next = CU_CORNERS[(CU_CORNERS.indexOf(cuRoot.dataset.corner) + 1) % CU_CORNERS.length];
  cuRoot.dataset.corner = next;
  try { localStorage.setItem(CU_POS_KEY, next); } catch (_) {}
}

// Sit inside the composer footer next to the app's own control when we can find
// it, and fall back to a floating corner chip when we can't. Re-checked on the
// tick because React remounts that footer.
function cuPlace() {
  const native = cuFindNative();
  if (native && native.parentElement) {
    if (cuRoot.parentElement !== native.parentElement || cuRoot.nextSibling !== native) {
      native.parentElement.insertBefore(cuRoot, native);
    }
    cuRoot.style.position = 'static';
    cuRoot.style.pointerEvents = 'auto';
    cuChipEl.classList.add('attached');
    // Collapse only the icon, never the button: the button stays in the DOM and
    // stays clickable, which is what keeps the native popover reachable.
    for (const svg of native.querySelectorAll(':scope > svg, :scope > span > svg')) {
      svg.style.display = 'none';
    }
    native.style.width = '0px';
    native.style.padding = '0px';
    native.style.overflow = 'hidden';
    return true;
  }
  if (cuRoot.parentElement !== document.body) document.body.appendChild(cuRoot);
  cuRoot.style.position = '';
  cuRoot.style.pointerEvents = '';
  cuChipEl.classList.remove('attached');
  return false;
}

function cuInstall() {
  if (cuRoot && cuRoot.isConnected) return;
  cuInjectCSS();
  cuRoot = document.createElement('div');
  cuRoot.id = 'cc-usage';
  cuRoot.dataset.corner = cuCorner();
  cuChipEl = document.createElement('div');
  cuChipEl.className = 'cc-u-chip';
  cuChipEl.title = 'Claude usage - click for the full breakdown, right-click to move it';
  // Clicking opens the app's own usage popover rather than doing something
  // custom. That also happens to be the only thing that puts the context-window
  // figure into the DOM, so it doubles as a manual refresh for `ctx`.
  cuChipEl.onclick = e => {
    e.stopPropagation();
    const native = cuFindNative();
    if (native) {
      native.style.width = '';
      native.style.padding = '';
      fireClick(native);
      setTimeout(() => { try { cuScanContext(); cuRender(); } catch (_) {} }, 260);
      setTimeout(() => { try { cuScanContext(); cuRender(); cuPlace(); } catch (_) {} }, 900);
    } else {
      cuCycleCorner();
    }
  };
  cuChipEl.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); cuCycleCorner(); };
  cuCardEl = document.createElement('div');
  cuCardEl.className = 'cc-u-card';
  cuRoot.appendChild(cuChipEl);
  cuRoot.appendChild(cuCardEl);
  document.body.appendChild(cuRoot);
  cuPlace();
}

function cuBucket(key) {
  if (key === 'ctx') {
    return cuCtx ? {pct: cuCtx.pct, resetMs: null} : null;
  }
  const b = cuPlan && cuPlan[key];
  if (!b || b.utilization == null) return null;
  const t = b.resets_at ? Date.parse(b.resets_at) : NaN;
  return {pct: cuPct(b.utilization), resetMs: Number.isFinite(t) ? t : null};
}

// No text label: the hue identifies the bucket (blue context, amber 5-hour,
// green weekly) and the hover card spells all of it out anyway. The labels were
// most of the chip's width and none of its information.
function cuItem(key, label, pct, resetMs) {
  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-flex;gap:3px;align-items:baseline;';
  wrap.title = label + (pct == null ? ': unknown' : ': ' + pct + '%');
  const v = document.createElement('span');
  v.className = 'v';
  v.textContent = pct == null ? '--' : pct + '%';
  v.style.color = cuColor(pct, key);
  wrap.appendChild(v);
  const left = resetMs == null ? null : cuFmtIn(resetMs - Date.now());
  if (left) {
    const r = document.createElement('span');
    r.className = 'r';
    r.textContent = left;
    wrap.appendChild(r);
  }
  return wrap;
}

function cuRender() {
  if (!cuRoot || !cuRoot.isConnected) return;

  cuChipEl.textContent = '';
  CU_CHIP.forEach((key, i) => {
    const label = key === 'ctx' ? 'Context window'
      : (CU_BUCKETS.find(b => b[0] === key) || [, key])[1];
    const b = cuBucket(key);
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '·';
      cuChipEl.appendChild(sep);
    }
    cuChipEl.appendChild(cuItem(key, label, b ? b.pct : null, b ? b.resetMs : null));
  });

  cuCardEl.textContent = '';
  const addRow = (label, pct, resetMs, extra) => {
    const row = document.createElement('div');
    row.className = 'cc-u-row';
    const l = document.createElement('span');
    l.className = 'l';
    l.textContent = label;
    const v = document.createElement('span');
    v.style.cssText = 'font-weight:700;color:' + cuColor(pct);
    v.textContent = pct == null ? '--' : pct + '%';
    row.appendChild(l);
    row.appendChild(v);
    const left = resetMs == null ? null : cuFmtIn(resetMs - Date.now());
    if (left || extra) {
      const r = document.createElement('span');
      r.style.cssText = 'opacity:.5;min-width:44px;text-align:right;';
      r.textContent = extra || left;
      row.appendChild(r);
    }
    cuCardEl.appendChild(row);
    const bar = document.createElement('div');
    bar.className = 'cc-u-bar';
    const fill = document.createElement('i');
    fill.style.width = (pct == null ? 0 : pct) + '%';
    fill.style.background = cuColor(pct);
    bar.appendChild(fill);
    cuCardEl.appendChild(bar);
  };

  if (cuCtx) {
    const detail = cuCtx.total
      ? Math.round(cuCtx.used / 1000) + 'k/' + Math.round(cuCtx.total / 1000) + 'k'
      : null;
    addRow('Context window', cuCtx.pct, null, detail);
  } else {
    addRow('Context window', null, null, 'n/a');
  }

  let any = false;
  for (const [key, label] of CU_BUCKETS) {
    const b = cuBucket(key);
    if (!b) continue;
    any = true;
    addRow(label, b.pct, b.resetMs);
  }

  const ex = cuPlan && cuPlan.extra_usage;
  if (ex && ex.is_enabled) {
    const detail = ex.monthly_limit != null
      ? (ex.used_credits ?? 0) + '/' + ex.monthly_limit : null;
    addRow('Extra usage', cuPct(ex.utilization), null, detail);
  }

  const foot = document.createElement('div');
  foot.className = 'cc-u-foot';
  if (!cuPlanAt) {
    foot.textContent = cuFailures ? 'no usage data (' + cuFailures + ' failed fetches)' : 'loading…';
  } else {
    const age = Date.now() - cuPlanAt;
    foot.textContent = 'updated ' + (age < 60000 ? 'just now' : cuFmtIn(age) + ' ago') +
      (age > CU_STALE_MS ? ' · stale' : '') +
      (any ? '' : ' · no plan buckets');
  }
  cuCardEl.appendChild(foot);
}

// ── bootstrap ───────────────────────────────────────────────────────────────

let cuStarted = false;
function installUsage() {
  if (cuStarted) return;
  cuStarted = true;
  cuLoadSnapshot();
  cuNetHook();
  cuInstall();
  cuRender();
  cuPoll().finally(cuSchedule);

  // Re-render (not re-fetch) so "resets in" counts down, and re-scan for the
  // context figure in case a popover opened since the last tick.
  setInterval(() => {
    if (document.hidden) return;
    if (!cuRoot || !cuRoot.isConnected) cuInstall();
    try { cuPlace(); } catch (_) {}
    try { cuScanContext(); } catch (_) {}
    cuRender();
  }, CU_TICK_MS);

  // Coming back to the window is the one moment a stale number is most visible.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cuPoll(); });
  window.addEventListener('focus', () => {
    if (Date.now() - cuPlanAt > 30000) cuPoll();
  });

  window.__ccUsage = function () {
    return {
      org: cuOrg, plan: cuPlan, planAgeMs: cuPlanAt ? Date.now() - cuPlanAt : null,
      ctx: cuCtx, failures: cuFailures, corner: cuRoot && cuRoot.dataset.corner,
      attachedTo: cuNative ? (cuNative.getAttribute('aria-label') || cuNative.tagName) : null,
      refresh: () => cuPoll(),
      probe: on => { try { localStorage.setItem(CU_PROBE_KEY, on ? '1' : '0'); } catch (_) {} },
      parseResetText,
    };
  };
}

// ── "approaching your weekly limit" nag ─────────────────────────────────────
//
// Dismissed rather than hidden where possible: clicking the app's own close
// control makes the app remember, so it stays gone instead of being re-rendered
// and re-hidden forever. Hiding is the fallback.
//
// Every guard here exists because of issues-fixed #18, where a hider matched a
// container that had grown to wrap the whole app and blanked the page: this
// only ever touches a box that is small, is not the app root, and does not
// contain the composer.
const CU_NAG_KEY = 'cc-hide-limit-nag';
const CU_NAG_RE = /approaching\s+(?:your\s+)?(?:weekly|usage|5-hour)\s+limit|you(?:'|’)?re\s+approaching|approaching\s+the\s+limit/i;
const _cuSeenNags = new WeakSet();

function dismissLimitNags() {
  try { if (localStorage.getItem(CU_NAG_KEY) === '0') return; } catch (_) {}
  const scope = document.querySelectorAll(
    '[role="dialog"],[role="alertdialog"],[role="alert"],[role="status"],' +
    '[data-state="open"],[data-radix-popper-content-wrapper]');
  for (const el of scope) {
    if (_cuSeenNags.has(el)) continue;
    const r = el.getBoundingClientRect();
    // Toast-or-banner sized only. A full-screen overlay is not this.
    if (r.height === 0 || r.height > 320 || r.width > 760) continue;
    if (el === document.body || el === document.documentElement) continue;
    if (el.querySelector('textarea,[contenteditable="true"],form')) continue;
    const text = el.innerText || '';
    if (!CU_NAG_RE.test(text)) continue;
    _cuSeenNags.add(el);
    const close = [...el.querySelectorAll('button')].find(b => {
      const lbl = (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '');
      return /close|dismiss|got it|okay|ok\b|not now/i.test(lbl);
    });
    if (close) {
      console.log('[cc-usage] dismissing limit nag via its own close button');
      fireClick(close);
    } else {
      console.log('[cc-usage] hiding limit nag (no close button found)');
      el.style.display = 'none';
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  DOM BEACON
//  CDP is still gated behind a signed CLAUDE_CDP_AUTH token (issues-fixed #1),
//  so there is no way to inspect the live renderer from outside the app. The
//  only channel out is the renderer log:
//      ~/.config/Claude/logs/claude.ai-web.log
//  console.error lands there, so this dumps a bounded, structured survey of the
//  few DOM facts a feature needs before it can be written safely. Same trick as
//  the ccDiag() beacon that diagnosed the blank-page bug (issues-fixed #18),
//  kept around this time instead of deleted, because every UI feature here dies
//  the same death: a selector guessed instead of measured.
//
//  Runs once, ~6s after load. Re-run any time from DevTools: window.__ccDump()
//  Turn the automatic run off with localStorage['cc-diag'] = '0'.
// ─────────────────────────────────────────────────────────────

const DIAG_KEY = 'cc-diag';
const DIAG_MAX = 12;

function dgRect(el) {
  const r = el.getBoundingClientRect();
  return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
}

function dgDesc(el) {
  const cls = (typeof el.className === 'string' ? el.className : '').trim().slice(0, 90);
  return {
    tag: el.tagName.toLowerCase(),
    label: (el.getAttribute('aria-label') || '').slice(0, 60) || undefined,
    cls: cls || undefined,
    rect: dgRect(el),
  };
}

// Which ancestors are actually constraining the chat column's width. Reports
// the computed max-width rather than a class name, so it works whether the cap
// comes from a Tailwind utility, an inline style, or a container query.
function dgWidthChain() {
  const anchor =
    document.querySelector('[data-testid*="message" i]') ||
    document.querySelector('main p, main article') ||
    document.querySelector('main');
  if (!anchor) return {note: 'no anchor found'};
  const chain = [];
  for (let el = anchor; el && el !== document.documentElement && chain.length < DIAG_MAX; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (cs.maxWidth !== 'none' || cs.width.endsWith('ch')) {
      chain.push({...dgDesc(el), maxWidth: cs.maxWidth, width: cs.width, margin: cs.marginLeft});
    }
  }
  return {anchor: dgDesc(anchor), constrained: chain};
}

// The top bar, and specifically which parts of it are drag regions - a drag
// region eats pointer events, which is why controls up there feel dead.
function dgTopBar() {
  const out = [];
  for (const el of document.querySelectorAll('button,[role="button"],[data-top-left],header,nav')) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.top > 56) continue;
    const cs = getComputedStyle(el);
    out.push({
      ...dgDesc(el),
      appRegion: cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region') || undefined,
    });
    if (out.length >= DIAG_MAX) break;
  }
  return out;
}

function dgUsageButtons() {
  const sel = 'button[aria-label*="usage" i],button[aria-label*="limit" i],button[aria-label*="plan" i]';
  return [...document.querySelectorAll(sel)].slice(0, DIAG_MAX).map(b => ({
    ...dgDesc(b),
    svgChildren: b.querySelectorAll('svg').length,
    text: (b.textContent || '').trim().slice(0, 40),
    parentCls: (typeof b.parentElement?.className === 'string' ? b.parentElement.className : '').slice(0, 90),
  }));
}

function dgNags() {
  const out = [];
  const sel = '[role="dialog"],[role="alert"],[role="alertdialog"],[role="status"],[data-state="open"]';
  for (const el of document.querySelectorAll(sel)) {
    const t = (el.innerText || '').trim();
    if (!t || t.length > 400) continue;
    if (!/limit|usage|approaching/i.test(t)) continue;
    out.push({...dgDesc(el), text: t.replace(/\s+/g, ' ').slice(0, 160),
              buttons: [...el.querySelectorAll('button')].slice(0, 6)
                .map(b => ((b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30)))});
    if (out.length >= 6) break;
  }
  return out;
}

function ccDump() {
  const out = {
    at: new Date().toISOString(),
    path: location.pathname,
    viewport: [window.innerWidth, window.innerHeight],
    zoom: +(window.devicePixelRatio || 1).toFixed(2),
    usageButtons: dgUsageButtons(),
    topBar: dgTopBar(),
    widthChain: dgWidthChain(),
    nags: dgNags(),
    bridge: Object.keys(window.ccBridge || {}),
  };
  // One line, so it is greppable in a log full of React noise.
  console.error('[cc-dump] ' + JSON.stringify(out));
  return out;
}

function dgBootstrap() {
  window.__ccDump = ccDump;
  let off = false;
  try { off = localStorage.getItem(DIAG_KEY) === '0'; } catch (_) {}
  if (off) return;
  // Late enough that the composer footer and sidebar have rendered.
  setTimeout(() => { try { ccDump(); } catch (e) { console.error('[cc-dump] failed', e); } }, 6000);
}

// ─────────────────────────────────────────────────────────────
//  TITLE WATCH
//  Claude Desktop reports a constant window caption of "Claude", so every
//  ActivityWatch event looks identical - "Claude → Claude" tells you nothing
//  about which conversation ate two hours. There is no aw-watcher for Claude
//  Desktop and no plugin API to write one.
//
//  Rather than scrape the app from outside, this sets document.title to the
//  active conversation name. Electron forwards page-title changes to the
//  BrowserWindow caption, KWin reports the caption to aw_watcher_kwin.py, and
//  the existing pipeline picks it up with no watcher at all. Claude is in
//  DETAIL_APPS in report.py, so per-conversation time appears automatically.
//
//  The DOM here is minified React with no stable hooks, so this runs a
//  cascade of independent strategies and takes the first plausible answer.
//  When they all miss it leaves the title alone - a stale title is a much
//  smaller problem than a blank one.
//
//  Debug from DevTools: window.__ccTitleDebug()
// ─────────────────────────────────────────────────────────────

const TW_DEFAULT = 'Claude';
const TW_MAX_LEN = 90;

// Titles that carry no information - never worth overriding the default with.
const TW_JUNK = new Set([
  '', 'claude', 'new chat', 'untitled', 'chats', 'projects', 'claude ai',
]);

function twClean(s) {
  if (typeof s !== 'string') return '';
  // React sprinkles zero-width joiners and NBSP through rendered text.
  s = s.replace(/[​-‍﻿]/g, '').replace(/ /g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > TW_MAX_LEN) s = s.slice(0, TW_MAX_LEN - 1) + '…';
  return s;
}

function twUsable(s) {
  s = twClean(s);
  if (!s || s.length < 2) return '';
  if (TW_JUNK.has(s.toLowerCase())) return '';
  // A blob of text this long is page content, not a title.
  if (s.length > TW_MAX_LEN) return '';
  return s;
}

// ── Strategies, cheapest and most reliable first ────────────────────────────

// 1. The sidebar marks the open conversation with aria-current. This is a
//    stable ARIA convention rather than a generated class name, so it should
//    survive redesigns better than anything else here.
function twFromSidebar() {
  const el = document.querySelector('nav [aria-current="page"], aside [aria-current="page"], [aria-current="page"]');
  return el ? twUsable(el.textContent) : '';
}

// 2. The topbar row workspace.js already keys off - the chat/project name sits
//    in the menu button inside it.
function twFromTopbar() {
  const rows = document.querySelectorAll('.flex.flex-wrap.gap-g5');
  for (const row of rows) {
    const btn = row.querySelector('button[aria-haspopup="menu"]');
    if (!btn) continue;
    const t = twUsable(btn.textContent);
    if (t) return t;
  }
  return '';
}

// 3. Any heading the page renders for the current view.
function twFromHeading() {
  for (const sel of ['h1', '[role="heading"][aria-level="1"]', 'header h2']) {
    const el = document.querySelector(sel);
    if (el) {
      const t = twUsable(el.textContent);
      if (t) return t;
    }
  }
  return '';
}

// 4. Route-derived fallback: at least distinguish a project or settings view
//    from a conversation, even when no name is readable.
function twFromRoute() {
  const p = location.pathname || '';
  if (/^\/project\//.test(p)) return 'Project';
  if (/^\/settings/.test(p)) return 'Settings';
  if (/^\/(new|chat\/new)?$/.test(p)) return 'New chat';
  return '';
}

const TW_STRATEGIES = [
  ['sidebar', twFromSidebar],
  ['topbar', twFromTopbar],
  ['heading', twFromHeading],
  ['route', twFromRoute],
];

function twResolve() {
  for (const [name, fn] of TW_STRATEGIES) {
    let t = '';
    try { t = fn(); } catch (_) { t = ''; }
    if (t) return { title: t, via: name };
  }
  return { title: '', via: 'none' };
}

let twLast = '';

function twApply() {
  const { title } = twResolve();
  // No candidate: leave whatever is there rather than blanking it.
  if (!title) return;
  if (title === twLast && document.title === twLast) return;
  twLast = title;
  try { document.title = title; } catch (_) {}
}

let _twTimer = null;
function twDebounced() {
  if (_twTimer) return;
  _twTimer = setTimeout(() => { _twTimer = null; twApply(); }, 400);
}

function twBootstrap() {
  if (!document.documentElement) { setTimeout(twBootstrap, 100); return; }

  // The app rewrites document.title back to "Claude" on navigation, so watch
  // the <title> node itself and re-assert, not just the body.
  new MutationObserver(twDebounced)
    .observe(document.documentElement, { childList: true, subtree: true });

  // Route changes in a SPA fire neither load nor a useful mutation on their
  // own; patch the history methods to catch them.
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    if (typeof orig !== 'function') continue;
    history[m] = function () {
      const r = orig.apply(this, arguments);
      twDebounced();
      return r;
    };
  }
  window.addEventListener('popstate', twDebounced);

  // Backstop for anything the observers miss.
  setInterval(twApply, 3000);
  twApply();

  window.__ccTitleDebug = function () {
    const out = { applied: document.title, last: twLast, candidates: {} };
    for (const [name, fn] of TW_STRATEGIES) {
      try { out.candidates[name] = fn(); } catch (e) { out.candidates[name] = 'ERR ' + e; }
    }
    return out;
  };
}

if (!document.documentElement || document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', twBootstrap);
} else {
  twBootstrap();
}

// ─────────────────────────────────────────────────────────────
//  MAIN SCAN + BOOTSTRAP
//  2026-07-12: trimmed to the one live feature - the project selector
//  panel (workspace.js). Everything else (usage badges, pins, rings,
//  rate-limit, chat numbers, banners, floating bar, topbar shortcuts,
//  WCO patch) was dead code behind disabled calls and has been removed.
//  See memory/features.md for what used to be here.
//  2026-08-18: usage is back (usage.js), rebuilt on the app's own
//  /api/organizations/<org>/usage endpoint rather than on popover scraping.
// ─────────────────────────────────────────────────────────────
let lastPath = '';

function scan() {
  document.querySelectorAll('.flex.flex-wrap.gap-g5').forEach(row => {
    if (row.querySelector('button[aria-haspopup="menu"]')) installPanel(row);
  });
  // The panel lives on <body> now, so nothing tears it down when its row goes;
  // this also re-clamps it against a row that has moved (sidebar toggle).
  prunePanels();
  // 2s is the right cadence for a toast: fast enough that it barely registers,
  // slow enough not to be a hot loop.
  try { dismissLimitNags(); } catch (_) {}

  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    document.querySelectorAll('[data-cc-row]').forEach(row => {
      delete row.dataset.ccRow;
      row.removeAttribute('data-cc-row');
    });
    removeAllPanels();
  }
}

let _scanTimer = null;
function debouncedScan() {
  if (_scanTimer) return;
  _scanTimer = setTimeout(() => { _scanTimer = null; scan(); }, 300);
}

function bootstrap() {
  if (!document.documentElement) { setTimeout(bootstrap, 100); return; }
  injectBaseCSS();
  // Wrapped: the usage readout talks to the network and the two features share
  // one IIFE scope, so an exception here would otherwise take the project panel
  // down with it.
  try { installUsage(); } catch (e) { console.error('[cc-usage] install failed', e); }
  try { dgBootstrap(); } catch (e) { console.error('[cc-dump] install failed', e); }
  new MutationObserver(debouncedScan)
    .observe(document.documentElement, {childList: true, subtree: true});
  setInterval(scan, 2000);
  scan();
}

if (!document.documentElement || document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

})();
