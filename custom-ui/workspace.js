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

// "⏱️ Time Management" → "Time Management ⏱️" in workspace panel
function emojiSuffix(name) {
  const m = name.match(/^([^\p{L}\p{N}]+)([\p{L}\p{N}].*)$/su);
  if (!m) return name;
  return m[2].trimEnd() + ' ' + m[1].trim();
}

const CC_TODOS = (typeof CC_AI_TODOS !== 'undefined') ? CC_AI_TODOS : {};
function ccTodo(folder) {
  const live = (typeof window.__CC_TODOS__ === 'object' && window.__CC_TODOS__) || null;
  if (live && live[folder] != null) return live[folder];
  return CC_TODOS[folder];
}

const loadWS = () => { try { return JSON.parse(localStorage.getItem(WS_KEY) || '[]'); } catch { return []; } };
const saveWS = list => localStorage.setItem(WS_KEY, JSON.stringify(list.slice(0, 40)));

function recordWS(conn, folder) {
  const list = loadWS().filter(w => !(w.conn === conn && w.folder === folder));
  list.unshift({conn, folder, ts: Date.now()});
  saveWS(list);
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
// environments — role="menuitemradio", not "radio". Confirmed via cc-ws-debug
// logs (2026-07-10): the conn menu's static "Add cloud environment…" etc.
// actions were captured fine, but "Local"/"Myserver" never showed up even
// after a settle-time wait — they were invisible to this selector, not late.
const _ITEM_SEL = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],' +
  '[role="option"],[role="radio"],[role="checkbox"],' +
  '[data-cmdk-item],[cmdk-item],[data-radix-collection-item],li,button';

// Finds the newly-opened menu, then waits for its item count to STABILIZE
// before returning — not just for the first non-empty snapshot. Confirmed
// via cc-ws-debug logs (2026-07-10): the connection menu renders its static
// "Add cloud environment… / Set up Remote Control… / Add SSH host…" actions
// immediately, then appends existing connections (e.g. "Myserver") a beat
// later once they load. The old code grabbed the first 3-item snapshot and
// never saw "Myserver" at all — not a click failure, a race.
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
      break; // count held steady for 250ms with at least one item — settled
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

    // Approach 1: React fiber handler — bypasses isTrusted
    tryFiberClick(connTarget);
    await sleep(220);

    // Approach 2: keyboard nav — Radix keydown doesn't check isTrusted
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
  // populate the dropdown — give non-Local connections more time.
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

    // Approach 1: React fiber handler — bypasses isTrusted
    tryFiberClick(folderTarget);
    await sleep(160);
    if (committed()) { console.error('[cc-ws-debug] committed via fiber'); return; }

    // Approach 2: Keyboard navigation — Radix keydown doesn't check isTrusted
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
  // picker) — it never lists projects. ccBridge.armFolder primes the main
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

  // SSH: the remote folder dropdown only offers "Browse remote folder…" —
  // never actual remote directory names (confirmed via cc-ws-debug logs,
  // 2026-07-10). Clicking it opens a Claude-native remote directory browser
  // (root/back/subfolder entries + Go/Cancel/Select Folder action buttons —
  // confirmed via cc-ws-debug). We ONLY click a folder entry when its name
  // is an EXACT match in the currently-shown listing, then look for a
  // "Select Folder" confirm button. We deliberately never blind-click "Go"
  // or press Enter here — an earlier version did, using just the folder's
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
      // rather than guessing — logging tells us the real starting dir/depth
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

async function browseConn(conn, wsRow) {
  if (!wsRow?.isConnected) return;
  const [connBtn, folderBtn] = wsRow.querySelectorAll('button[aria-haspopup="menu"]');
  if (!connBtn || !folderBtn) return;
  const currentConn = connBtn.querySelector('span')?.textContent?.trim() || '';
  if (currentConn !== conn) {
    fireClick(connBtn);
    const items = await waitNewMenu();
    const t = items.find(el => el.textContent.includes(conn));
    if (t) { fireClick(t); await sleep(350); }
  }
  const [, fb] = wsRow.querySelectorAll('button[aria-haspopup="menu"]');
  if (fb) fireClick(fb);
}

function makeItemBtn(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.style.cssText = 'display:block;width:100%;text-align:left;padding:3px 6px;margin-bottom:1px;' +
    'border:0;border-radius:4px;background:transparent;color:inherit;' +
    'font:inherit;font-size:11px;cursor:pointer;white-space:normal;word-break:break-word;';
  b.onmouseenter = () => b.style.background = 'var(--bg-200,rgba(128,128,128,.15))';
  b.onmouseleave = () => b.style.background = 'transparent';
  b.onclick = e => { e.stopPropagation(); onClick(); };
  return b;
}

function buildColumn(conn, folders, wsRow) {
  const col = document.createElement('div');
  col.style.cssText = 'flex:1;min-width:0;';
  const hdr = document.createElement('div');
  hdr.style.cssText = 'font-size:10px;font-weight:600;opacity:.5;text-transform:uppercase;' +
    'letter-spacing:.05em;margin-bottom:5px;padding:0 2px;';
  hdr.textContent = conn === 'Local' ? 'Local' : 'Myserver (SSH)';
  col.appendChild(hdr);
  if (!folders.length) {
    const hint = document.createElement('div');
    hint.textContent = conn === 'Local' ? 'No projects found' : 'No recent folders';
    hint.style.cssText = 'font-size:10px;opacity:.35;padding:2px 4px;';
    col.appendChild(hint);
  } else {
    const grid = document.createElement('div');
    if (folders.length > 4) {
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:1px 4px;';
    }
    for (const folder of folders) {
      const name = emojiSuffix(folder.split('/').filter(Boolean).pop() || folder);
      const btn = makeItemBtn(name, () => clickWorkspace(conn, folder, wsRow));
      btn.title = folder;
      // TODO preview works for any folder we have baked/live text for, not
      // just Local — if a future data source ever populates ccTodo() for
      // Myserver paths (e.g. a remote fetch), the hover just starts working.
      // Today __CC_TODOS__/CC_AI_TODOS are only ever populated for Local
      // (cc-ai-data-v2 reads the local filesystem — see update-ui.sh), so
      // Myserver entries currently fall through to "No TODO.md" below.
      if (ccTodo(folder)) {
        btn.addEventListener('mouseenter', () => showTodoPreview(folder));
      }
      grid.appendChild(btn);
    }
    col.appendChild(grid);
  }
  const browse = makeItemBtn('Browse…', () => browseConn(conn, wsRow));
  browse.style.color = 'var(--accent,#4a90e2)';
  browse.style.opacity = '.8';
  browse.style.marginTop = '4px';
  col.appendChild(browse);
  return col;
}

// Safe markdown → DOM renderer for TODO preview. No innerHTML — XSS-safe.
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
  _todoPreviewEl.firstChild.textContent = name + ' — TODO.md';
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
  const M = [...new Set(ws.filter(w => w.conn === 'Myserver').map(w => w.folder))];
  panel.innerHTML = '';
  const cols = document.createElement('div');
  cols.style.cssText = 'display:flex;gap:10px;';
  cols.appendChild(buildColumn('Local',    L, panel._wsRow));
  cols.appendChild(buildColumn('Myserver', M, panel._wsRow));
  panel.appendChild(cols);

  const preview = document.createElement('div');
  preview.style.cssText = 'margin-top:10px;padding-top:8px;' +
    'border-top:1px solid var(--claude-border,rgba(128,128,128,.22));';
  const phdr = document.createElement('div');
  phdr.style.cssText = 'font-size:10px;font-weight:600;opacity:.55;text-transform:uppercase;' +
    'letter-spacing:.05em;margin-bottom:5px;';
  const pbody = document.createElement('div');
  pbody.style.cssText = 'margin:0;font-size:11px;line-height:1.4;' +
    'word-break:break-word;height:240px;overflow:auto;opacity:.85;font-family:inherit;';
  preview.appendChild(phdr);
  preview.appendChild(pbody);
  panel.appendChild(preview);
  _todoPreviewEl = preview;

  const seed = L.find(f => ccTodo(f));
  if (seed) showTodoPreview(seed);
  else { phdr.textContent = 'TODO.md'; pbody.textContent = 'Hover a project to preview its TODO.md'; }
}

function removeAllPanels() { document.querySelectorAll('.' + PANEL_CLS).forEach(p => p.remove()); }

function installPanel(wsRow) {
  if (wsRow.dataset.ccRow) return;
  wsRow.dataset.ccRow = '1';
  wsRow.style.position = 'relative';
  wsRow.addEventListener('click', () => setTimeout(() => {
    const btns = [...wsRow.querySelectorAll('button[aria-haspopup="menu"]')];
    if (btns.length >= 2) {
      const conn   = btns[0].querySelector('span')?.textContent?.trim();
      const folder = btns[1].querySelector('span')?.textContent?.trim();
      if (conn && folder) recordWS(conn, folder);
    }
  }, 400), true);
  if (location.pathname.includes('/chat/')) return;
  const panel = document.createElement('div');
  panel.className = PANEL_CLS;
  panel._wsRow = wsRow;
  panel.style.cssText = 'position:absolute;bottom:calc(100% + 6px);left:0;z-index:200;' +
    'background:#faf9f5;' +
    'border:1px solid var(--claude-border,rgba(128,128,128,.22));' +
    'border-radius:8px;padding:10px 12px;' +
    'width:min(900px,calc(100vw - 40px));max-width:calc(100vw - 40px);' +
    'box-shadow:0 4px 20px rgba(0,0,0,.16);font-family:inherit;';
  wsRow.appendChild(panel);
  rebuildPanel();
}
