/**
 * Claude Desktop custom UI - v17
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

// "⏱️ Time Management" → {emoji:"⏱️", text:"Time Management"}
// Emoji and text are kept separate so the panel can render the emoji in its
// own span - it gets scaled up (see EMOJI_CSS) to be easier to pick out at a
// glance, and emoji-only mode drops the text entirely.
function splitEmoji(name) {
  const m = name.match(/^([^\p{L}\p{N}]+)([\p{L}\p{N}].*)$/su);
  if (!m) return {emoji: '', text: name};
  return {emoji: m[1].trim(), text: m[2].trimEnd()};
}

// "⏱️ Time Management" → "Time Management ⏱️" (TODO-preview header)
function emojiSuffix(name) {
  const {emoji, text} = splitEmoji(name);
  return emoji ? text + ' ' + emoji : text;
}

// Oversized emoji that does NOT grow the line box: `line-height:0` makes an
// inline element contribute nothing to the line height, so rows stay the same
// height as text-only rows no matter how large font-size gets.
const EMOJI_CSS = 'font-size:1.5em;line-height:0;display:inline-block;' +
  'vertical-align:-0.08em;flex:none;';

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

const loadWS = () => { try { return JSON.parse(localStorage.getItem(WS_KEY) || '[]'); } catch { return []; } };
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

function matchFolder(itemText, folder) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = folder.split('/').filter(Boolean).pop() || folder;
  const it = norm(itemText), f = norm(name);
  return it === f || it.includes(f) || f.includes(it);
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
  const folderTarget = folderItems.find(el => {
    const val = el.getAttribute('data-value') || el.getAttribute('value') || '';
    if (val && matchFolder(val, folder)) return true;
    return matchFolder(el.textContent, folder);
  });
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

      const exactTarget = entries.find(el => matchFolder(el.textContent, folder));
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
  b.style.cssText = 'display:flex;align-items:center;gap:5px;text-align:left;' +
    'padding:2px 5px;border:0;border-radius:4px;background:transparent;color:inherit;' +
    'font:inherit;font-size:11px;line-height:1.55;cursor:pointer;' +
    (compact ? 'justify-content:center;width:auto;' : 'width:100%;');

  if (emoji) {
    const e = document.createElement('span');
    e.style.cssText = EMOJI_CSS + (compact ? 'font-size:1.9em;' : '');
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
  // to "No TODO.md".
  if (ccTodo(folder)) b.addEventListener('mouseenter', () => showTodoPreview(folder));
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
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:1px 2px;';
    folders = folders.filter(f => splitEmoji(f.split('/').filter(Boolean).pop() || f).emoji);
  } else if (folders.length > 4) {
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 6px;';
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

let _todoPreviewEl = null;
function showTodoPreview(folder) {
  if (!_todoPreviewEl) return;
  const name = emojiSuffix(folder.split('/').filter(Boolean).pop() || folder);
  const text = ccTodo(folder);
  // firstChild is the header row; its first child is the title span (the
  // emoji-only toggle is its sibling and must survive the write).
  _todoPreviewEl.firstChild.firstChild.textContent = name + ' - TODO.md';
  if (text) renderMarkdownInto(_todoPreviewEl.lastChild, text);
  else _todoPreviewEl.lastChild.textContent = 'No TODO.md in this folder.';
}

function rebuildPanel() {
  const panel = document.querySelector('.' + PANEL_CLS);
  if (!panel?._wsRow) return;
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

  panel.innerHTML = '';
  const cols = document.createElement('div');
  cols.style.cssText = 'display:flex;gap:4px;';
  cols.appendChild(buildColumn('Local', L, panel._wsRow));
  cols.appendChild(buildRemoteColumn(remote, panel._wsRow));
  panel.appendChild(cols);

  const preview = document.createElement('div');
  preview.style.cssText = 'margin-top:8px;padding-top:6px;' +
    'border-top:1px solid var(--claude-border,rgba(128,128,128,.22));';

  const phdr = document.createElement('div');
  phdr.style.cssText = 'display:flex;align-items:center;gap:8px;' +
    'font-size:10px;font-weight:600;opacity:.55;text-transform:uppercase;' +
    'letter-spacing:.05em;margin-bottom:5px;';
  // phdr's first child carries the title text (showTodoPreview writes to it);
  // the emoji-only toggle sits beside it.
  const ptitle = document.createElement('span');
  ptitle.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  phdr.appendChild(ptitle);

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
  phdr.appendChild(toggle);

  const pbody = document.createElement('div');
  // Fixed 240px used to push the panel off-screen at high browser zoom (the
  // panel is anchored above the workspace row, so it grows upward). Cap it
  // against the viewport instead.
  pbody.style.cssText = 'margin:0;font-size:11px;line-height:1.4;' +
    'word-break:break-word;max-height:min(240px,28vh);overflow:auto;opacity:.85;font-family:inherit;';
  preview.appendChild(phdr);
  preview.appendChild(pbody);
  panel.appendChild(preview);
  _todoPreviewEl = preview;

  const seed = L.find(f => ccTodo(f));
  if (seed) showTodoPreview(seed);
  else { ptitle.textContent = 'TODO.md'; pbody.textContent = 'Hover a project to preview its TODO.md'; }

  clampPanel(panel);
}

function removeAllPanels() {
  document.querySelectorAll('.' + PANEL_CLS).forEach(p => { p._ro?.disconnect(); p.remove(); });
}

// Records the workspace the row is actually SHOWING, not whatever it shows
// mid-switch. Switching connection then folder is two async steps: sampling
// once at a fixed delay could catch the new host paired with the previous
// (Local) folder, and that bogus pair then sat in the remote column forever,
// sending clickWorkspace hunting for a local folder on an SSH host. So: take
// two samples ~700ms apart and only record if they agree with no menu open.
function readWSLabels(wsRow) {
  const btns = [...wsRow.querySelectorAll('button[aria-haspopup="menu"]')];
  if (btns.length < 2) return null;
  const conn   = cleanLabel(btns[0].querySelector('span')?.textContent);
  const folder = cleanLabel(btns[1].querySelector('span')?.textContent);
  return (conn && folder) ? {conn, folder} : null;
}

function sampleWS(wsRow) {
  setTimeout(() => {
    if (!wsRow.isConnected) return;
    const a = readWSLabels(wsRow);
    if (!a) return;
    setTimeout(() => {
      if (!wsRow.isConnected || document.querySelector(_MENU_SEL)) return;
      const b = readWSLabels(wsRow);
      if (b && b.conn === a.conn && b.folder === a.folder) recordWS(b.conn, b.folder);
    }, 700);
  }, 400);
}

function installPanel(wsRow) {
  if (wsRow.dataset.ccRow) return;
  wsRow.dataset.ccRow = '1';
  wsRow.style.position = 'relative';
  wsRow.addEventListener('click', () => sampleWS(wsRow), true);
  if (location.pathname.includes('/chat/')) return;
  const panel = document.createElement('div');
  panel.className = PANEL_CLS;
  panel._wsRow = wsRow;
  // Sepia rather than near-white: monochrome emoji (☑ ⏱ ✂ …) disappear against
  // #faf9f5 but read clearly against a warm ground.
  panel.style.cssText = 'position:absolute;bottom:calc(100% + 6px);left:0;z-index:200;' +
    'background:#f2e8d5;' +
    'border:1px solid var(--claude-border,rgba(128,128,128,.22));' +
    'border-radius:8px;padding:10px 12px;' +
    'width:min(760px,calc(100vw - 24px));max-width:calc(100vw - 24px);' +
    'overflow:auto;' +  // max-height is set per-frame by clampPanel
    'box-shadow:0 4px 20px rgba(0,0,0,.16);font-family:inherit;';
  wsRow.appendChild(panel);
  rebuildPanel();
  // The panel's own size changes without the viewport changing (TODO preview
  // swap, emoji-only toggle), and those need a re-clamp too.
  if (typeof ResizeObserver === 'function') {
    panel._ro = new ResizeObserver(scheduleClamp);
    panel._ro.observe(panel);
  }
  installClampListeners();
  clampPanel(panel);
}

// Zoom and window resize both move the row and change the viewport, and
// neither used to re-run clampPanel - the panel kept a stale `left` offset
// and a max-height that ignored where the row actually sits, so it wandered
// off-screen. Registered once, coalesced to one clamp per frame.
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

// The panel is anchored to the workspace row (left:0), so on an indented row -
// or at high browser zoom, where CSS pixels grow and the viewport shrinks - a
// full-width panel runs off the right edge. Nudge it back by hand; CSS alone
// can't express "clamp to viewport" for an absolutely-positioned box whose
// containing block is off-centre.
function clampPanel(panel) {
  if (!panel?.isConnected) return;
  const margin = 12;

  // Vertical: the panel grows UPWARD from the row, so the space it has is the
  // gap between the top of the window and the top of the row - not the whole
  // viewport height. A fixed calc(100vh - 90px) ignored where the row sits and
  // let a tall list (or a zoomed-in viewport) push the panel off the top.
  const rowTop = panel._wsRow?.getBoundingClientRect().top ?? window.innerHeight;
  const GAP = 6; // matches bottom:calc(100% + 6px)
  const maxH = Math.max(140, Math.round(rowTop - GAP - margin)) + 'px';
  if (panel.style.maxHeight !== maxH) panel.style.maxHeight = maxH;

  panel.style.left = '0px';
  const r = panel.getBoundingClientRect();
  let shift = 0;
  if (r.right > window.innerWidth - margin) shift = window.innerWidth - margin - r.right;
  if (r.left + shift < margin) shift = margin - r.left;
  if (shift) panel.style.left = shift + 'px';
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
// ─────────────────────────────────────────────────────────────
let lastPath = '';

function scan() {
  document.querySelectorAll('.flex.flex-wrap.gap-g5').forEach(row => {
    if (row.querySelector('button[aria-haspopup="menu"]')) installPanel(row);
  });

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
