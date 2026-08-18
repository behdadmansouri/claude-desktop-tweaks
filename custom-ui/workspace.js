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
let _preEditText = null;  // in-memory undo for the whole editing session

// Rendered view and edit view are two elements in the same slot, so switching
// between them can't change the pane's geometry (the whole point of #22).
// Click the text to edit, click anywhere else to go back to reading it - no
// edit/done button to hunt for.
function setEditing(on) {
  if (!_prevBody) return;
  const want = !!on && !!_prevFolder;
  if (want === _editing) return;
  _editing = want;
  _prevBody.style.display = _editing ? 'none' : '';
  _prevEdit.style.display = _editing ? '' : 'none';
  _prevBar.revertBtn.style.display = _editing ? '' : 'none';
  if (_editing) {
    _preEditText = ccTodo(_prevFolder) || '';
    _prevEdit.value = _preEditText;
    _prevEdit.focus();
  } else {
    // Leaving the editor is a commit point: don't wait out the debounce.
    flushSave();
    if (_prevFolder) showTodoPreview(_prevFolder);
  }
}

// Restores the text as it was when this editing session started. The on-disk
// backups (see cc-write-todo) cover everything older; this covers the case that
// actually happens, which is selecting all and typing over it by accident.
function revertEdit() {
  if (!_editing || _preEditText == null) return;
  _prevEdit.value = _preEditText;
  saveTodoSoon();
  _prevEdit.focus();
}

function setSaveState(msg, bad) {
  if (!_prevBar) return;
  _prevBar.status.textContent = msg || '';
  _prevBar.status.style.color = bad ? '#ef4444' : 'inherit';
}

// Writes through ccBridge.writeTodo -> cc-write-todo ipcMain handler, which is
// the only process with fs access. Debounced: this fires on every keystroke.
async function doSave(folder, text) {
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
}

function saveTodoSoon() {
  if (!_prevFolder) return;
  const folder = _prevFolder, text = _prevEdit.value;
  setSaveState('…');
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => doSave(folder, text), 600);
}

// Write now rather than in 600ms. Called when the editor closes and on unload,
// so a pending keystroke can't be lost by clicking away or quitting.
function flushSave() {
  if (!_saveTimer || !_prevFolder || !_prevEdit) return;
  clearTimeout(_saveTimer);
  _saveTimer = null;
  doSave(_prevFolder, _prevEdit.value);
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

  const revertBtn = mkAction('revert', 'Put the text back to how it was when you started editing');
  revertBtn.style.display = 'none';
  revertBtn.onclick = e => { e.stopPropagation(); revertEdit(); };
  // The one-click "open the folder" the panel was missing: ccBridge.openFolder
  // already existed for this, wired to shell.openPath in the main process.
  const openBtn = mkAction('open', 'Open this folder in the file manager');
  openBtn.onclick = e => {
    e.stopPropagation();
    if (_prevFolder && window.ccBridge?.openFolder) window.ccBridge.openFolder(_prevFolder);
  };

  phead.appendChild(ptitle);
  phead.appendChild(pstatus);
  phead.appendChild(revertBtn);
  phead.appendChild(openBtn);

  const pbody = document.createElement('div');
  pbody.style.cssText = 'flex:1;min-height:0;overflow:auto;font-size:11px;line-height:1.4;' +
    'word-break:break-word;opacity:.85;font-family:inherit;cursor:text;';
  pbody.title = 'Click to edit. Click anywhere else to go back to reading.';
  pbody.onclick = e => { e.stopPropagation(); setEditing(true); };

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
  _prevBar = {wrap: phead, status: pstatus, revertBtn, openBtn};
  installEditExitListeners();
  body.appendChild(list);
  body.appendChild(prev);
  panel.appendChild(head);
  panel.appendChild(body);

  panel._els = {head, htitle, coll, body, list, prev, phead, ptitle, pbody, pedit};
  _prevTitle = ptitle;
  _prevBody = pbody;
  applyCollapsed(panel);
}

// Click-away closes the editor. Registered once on the document, in the capture
// phase, so it still fires when the app stops the event on the way up.
let _editExitInstalled = false;
function installEditExitListeners() {
  if (_editExitInstalled) return;
  _editExitInstalled = true;
  document.addEventListener('mousedown', e => {
    if (!_editing) return;
    const t = e.target;
    // Anything inside the textarea or the preview header (revert, open) keeps
    // the editor open; everything else commits and goes back to reading.
    if (_prevEdit && (t === _prevEdit || _prevEdit.contains(t))) return;
    if (_prevBar && _prevBar.wrap.contains(t)) return;
    setEditing(false);
  }, true);
  // Quitting or navigating away must not drop an un-flushed keystroke.
  window.addEventListener('beforeunload', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
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
    if (_prevBar) _prevBar.openBtn.style.display = 'none';
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
