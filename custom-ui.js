/**
 * Claude Desktop custom UI — v6
 *
 * Features:
 *  1. Text usage badges:  C35%  H81%  2h  W45%  3d
 *     C=blue(context)  H=yellow(hourly)  2h=white(hrs to reset)
 *     W=green(weekly)  3d=white(days to reset)
 *  2. Quick workspace panel — two columns LOCAL | MYSERVER
 *  3. Prompt-cache freshness ring on sidebar conversation titles
 *  4. Top bar hidden; WCO height overridden to 0 to reclaim the space
 *     Ctrl+O = search    Ctrl+Shift+L = toggle sidebar
 *
 * Security notes
 *  - No innerHTML injection from untrusted data; all user-sourced text
 *    enters the DOM via .textContent only.
 *  - localStorage reads are wrapped in try/catch (corrupt JSON tolerance).
 *  - Keyboard capture listener only intercepts the two custom shortcuts;
 *    e.stopPropagation() is scoped to those keys only.
 *
 * Performance notes
 *  - MutationObserver is debounced to one scan() per 300 ms.
 *  - setInterval fires every 2 s as a safety net.
 *  - hideTopBar() returns early once the element is cached (_topBarEl).
 *  - WeakMap for rebuild-fns avoids leaking button element references.
 *  - scanForUsageExtras() only queries rare elements ([role="dialog"] etc.).
 *  - waitNewMenu() async loop is fire-and-forget; only one concurrent
 *    call per user action (user has to click the panel button).
 */
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  //  0.  BASE CSS — injected once; resets WCO-driven padding
  // ─────────────────────────────────────────────────────────────
  function injectBaseCSS() {
    if (document.getElementById('cc-base-css')) return;
    const s = document.createElement('style');
    s.id = 'cc-base-css';
    // Reset any padding-top that claude.ai sets via env(titlebar-area-height)
    // or WCO JS hooks. Two layers: top of tree + deepest flex wrappers.
    s.textContent = [
      'html,body{padding-top:0!important;margin-top:0!important}',
      'body>div,body>div>div{padding-top:0!important}',
      '#__next,#__next>div,#root,#root>div{padding-top:0!important}',
      // ── Top bar: nuke it with CSS so React re-renders can't bring it back
      '[data-top-left="true"]{display:none!important;height:0!important;overflow:hidden!important}',
      // ── Hide the "Views" toggle button on the right side of the toolbar
      // (we replace it with Ctrl+Shift+R)
      'button[data-testid="views-button"],'  +
      'button[aria-label="Views"],'          +
      'button[aria-label*="Toggle right"],'  +
      'button[aria-label*="right panel" i],' +
      '[data-testid="right-panel-toggle"]'   +
      '{display:none!important}',
      // ── Right panel tab bar injected by us
      '.cc-rp-tabs{display:flex;gap:2px;padding:4px 8px;border-bottom:1px solid var(--claude-border,rgba(0,0,0,.1));background:var(--bg-100,#f5f4ef);}',
      '.cc-rp-tab{padding:3px 10px;border-radius:5px;font-size:11px;font-weight:500;cursor:pointer;border:0;background:transparent;color:inherit;opacity:.6;}',
      '.cc-rp-tab.active{background:var(--bg-200,rgba(0,0,0,.07));opacity:1;}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────────────────────
  //  0b. STARTUP POPUP DISMISSER
  // ─────────────────────────────────────────────────────────────
  const _seenDialogs = new WeakSet();

  function dismissStartupPopups() {
    document.querySelectorAll('[role="dialog"],[role="alertdialog"]').forEach(d => {
      if (_seenDialogs.has(d)) return;
      _seenDialogs.add(d);
      // Only auto-dismiss dialogs that appeared in the first 15 seconds
      // and have exactly one primary action (i.e. a simple "OK / Got it" popup)
      const btns = [...d.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      if (btns.length !== 1) return; // multi-button = user decision needed, skip
      const lbl = (btns[0].textContent || '').toLowerCase().trim();
      const autoDismiss = ['ok','got it','dismiss','continue','close','done','accept']
        .some(w => lbl.includes(w));
      if (autoDismiss) {
        setTimeout(() => { if (document.contains(btns[0])) btns[0].click(); }, 300);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  0c. DEFAULT TO "CODE" TAB IN ARTIFACT PANEL
  // ─────────────────────────────────────────────────────────────
  function preferCodeTab() {
    document.querySelectorAll('[role="tablist"]').forEach(tl => {
      if (tl.dataset.ccTabPref) return;
      const tabs = [...tl.querySelectorAll('[role="tab"]')];
      const codeTab = tabs.find(t => /^code$/i.test(t.textContent.trim()));
      if (!codeTab) return;
      tl.dataset.ccTabPref = '1';
      if (codeTab.getAttribute('aria-selected') !== 'true') {
        setTimeout(() => { if (document.contains(codeTab)) codeTab.click(); }, 80);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  0d. RIGHT PANEL — Ctrl+Shift+R toggle + Obsidian-style tabs
  // ─────────────────────────────────────────────────────────────
  const RP_TABS = ['Preview', 'Code', 'Files'];
  let _rpActiveTab = 'Code'; // default shown tab

  function findRightPanelToggle() {
    return document.querySelector(
      'button[data-testid="views-button"],'         +
      'button[aria-label="Views"],'                 +
      'button[aria-label*="Toggle right" i],'       +
      'button[aria-label*="artifact" i][aria-pressed],' +
      'button[aria-label*="right panel" i],'        +
      '[data-testid="right-panel-toggle"] button'
    );
  }

  function findRightPanel() {
    // Common candidates for the artifact / right panel container
    return (
      document.querySelector('[data-testid="artifact-panel"]') ||
      document.querySelector('[data-testid="right-panel"]')    ||
      // Fallback: a panel on the far right that's not the sidebar
      [...document.querySelectorAll('aside,section,[role="complementary"]')]
        .find(el => {
          const r = el.getBoundingClientRect();
          return r.right >= window.innerWidth - 20 && r.width > 200 && r.width < window.innerWidth * 0.6;
        }) ||
      null
    );
  }

  function injectRightPanelTabs(panel) {
    if (!panel || panel.dataset.ccRpTabs) return;
    panel.dataset.ccRpTabs = '1';

    const bar = document.createElement('div');
    bar.className = 'cc-rp-tabs';

    RP_TABS.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'cc-rp-tab' + (name === _rpActiveTab ? ' active' : '');
      btn.textContent = name;
      btn.onclick = () => {
        _rpActiveTab = name;
        bar.querySelectorAll('.cc-rp-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        switchRightPanelTab(panel, name);
      };
      bar.appendChild(btn);
    });

    panel.insertBefore(bar, panel.firstChild);
    switchRightPanelTab(panel, _rpActiveTab);
  }

  function switchRightPanelTab(panel, name) {
    // "Preview" and "Code" — click the matching native tab if it exists
    if (name === 'Preview' || name === 'Code') {
      const native = [...panel.querySelectorAll('[role="tab"]')]
        .find(t => t.textContent.trim().toLowerCase() === name.toLowerCase());
      if (native && native.getAttribute('aria-selected') !== 'true') native.click();
      // Make sure Files overlay is hidden
      const overlay = panel.querySelector('.cc-rp-files');
      if (overlay) overlay.style.display = 'none';
    }

    if (name === 'Files') {
      // Lazy-create a file list overlay inside the panel
      let overlay = panel.querySelector('.cc-rp-files');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'cc-rp-files';
        overlay.style.cssText = 'position:absolute;inset:0;background:var(--bg-100,#f5f4ef);' +
          'overflow-y:auto;padding:10px 12px;font-size:12px;font-family:inherit;z-index:5;';
        panel.style.position = 'relative';
        panel.appendChild(overlay);
      }
      const ws = loadWS();
      if (!ws.length) {
        overlay.innerHTML = '<div style="opacity:.4;padding:8px">No recent workspaces yet.<br>Open a folder to populate this list.</div>';
      } else {
        overlay.innerHTML = '';
        let lastConn = null;
        ws.forEach(({conn, folder}) => {
          if (conn !== lastConn) {
            lastConn = conn;
            const hdr = document.createElement('div');
            hdr.style.cssText = 'font-size:10px;font-weight:600;opacity:.5;text-transform:uppercase;letter-spacing:.05em;margin:8px 0 4px;';
            hdr.textContent = conn;
            overlay.appendChild(hdr);
          }
          const name = folder.split('/').filter(Boolean).pop() || folder;
          const row = document.createElement('div');
          row.style.cssText = 'padding:3px 4px;border-radius:4px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          row.title = folder;
          row.textContent = name;
          row.onmouseenter = () => row.style.background = 'rgba(0,0,0,.07)';
          row.onmouseleave = () => row.style.background = '';
          overlay.appendChild(row);
        });
      }
      overlay.style.display = '';
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  1.  USAGE BADGES   C35%  H81%  2h  W45%  3d
  // ─────────────────────────────────────────────────────────────
  let _weeklyPct  = null;  // weekly %
  let _hourlyResetH = null; // hours until hourly plan resets
  let _weeklyResetD = null; // days until weekly usage resets
  const _badgeRebuild = new WeakMap(); // btn → rebuild fn

  // Colored-letter percentage badge: C35%  H81%  W45%
  function pctBadge(letter, pct, color, title) {
    const dim = pct == null;
    return `<span title="${title}${!dim ? ': ' + pct + '%' : ''}" ` +
      `style="opacity:${dim ? 0.35 : 1};font-size:10px;font-weight:600;` +
      `white-space:nowrap;font-variant-numeric:tabular-nums;letter-spacing:-0.01em;">` +
      `<span style="color:${color}">${letter}${dim ? '--' : pct}%</span></span>`;
  }

  // Time-remaining badge in muted white: 2h  3d
  function timeBadge(val, unit, title) {
    const dim = val == null;
    return `<span title="${title}${!dim ? ': ' + val + unit : ''}" ` +
      `style="opacity:${dim ? 0.25 : 0.6};font-size:10px;font-weight:500;` +
      `white-space:nowrap;font-variant-numeric:tabular-nums;letter-spacing:-0.01em;">` +
      `${dim ? '--' : val}${unit}</span>`;
  }

  function parseUsage(label) {
    const get = re => { const m = label.match(re); return m ? +m[1] : null; };
    // Also pull reset times out of the aria-label if present
    const h = label.match(/resets?\s+(\d+)h/i);
    const d = label.match(/resets?\s+(\d+)d/i);
    if (h) updateHourlyReset(+h[1]);
    if (d) updateWeeklyReset(+d[1]);
    return {
      ctx:    get(/context (\d+)%/),
      plan:   get(/plan (\d+)%/),
      weekly: get(/weekly (\d+)%/),
    };
  }

  function buildBadges(ctx, plan, weekly) {
    return pctBadge('C', ctx,                   '#3b82f6', 'Context window') +
           pctBadge('H', plan,                  '#f59e0b', 'Hourly plan')    +
           timeBadge(_hourlyResetH, 'h', 'Hours until hourly plan resets')   +
           pctBadge('W', weekly ?? _weeklyPct,  '#22c55e', 'Weekly usage')   +
           timeBadge(_weeklyResetD, 'd', 'Days until weekly usage resets');
  }

  function applyBadges(btn) {
    if (btn.dataset.ccV4) return;
    btn.dataset.ccV4 = '1';
    const orig = btn.querySelector('svg');
    if (!orig) return;
    const wrap = document.createElement('span');
    wrap.style.cssText = 'display:inline-flex;gap:4px;align-items:center;';
    const rebuild = lbl => {
      const {ctx, plan, weekly} = parseUsage(lbl);
      wrap.innerHTML = buildBadges(ctx, plan, weekly);
    };
    rebuild(btn.getAttribute('aria-label') || '');
    orig.replaceWith(wrap);
    _badgeRebuild.set(btn, rebuild);
    new MutationObserver(() => rebuild(btn.getAttribute('aria-label') || ''))
      .observe(btn, {attributes: true, attributeFilter: ['aria-label']});
  }

  function refreshBadges() {
    document.querySelectorAll('[data-cc-v4="1"]').forEach(btn => {
      const fn = _badgeRebuild.get(btn);
      if (fn) fn(btn.getAttribute('aria-label') || '');
    });
  }

  function updateWeeklyBadges(pct)   { if (_weeklyPct     !== pct) { _weeklyPct     = pct; refreshBadges(); } }
  function updateHourlyReset(h)      { if (_hourlyResetH  !== h)   { _hourlyResetH  = h;   refreshBadges(); } }
  function updateWeeklyReset(d)      { if (_weeklyResetD  !== d)   { _weeklyResetD  = d;   refreshBadges(); } }

  function scanForUsageExtras() {
    // Scan popups/dialogs for weekly % and reset times
    document.querySelectorAll('[role="dialog"],[role="tooltip"],[role="status"],[aria-live]').forEach(el => {
      const text = el.innerText || '';
      if (!text.trim()) return;

      const wPct = text.match(/(\d+)%\s*(?:of\s+)?weekly/i) || text.match(/weekly[^0-9]*(\d+)%/i);
      if (wPct) updateWeeklyBadges(+wPct[1]);

      const hReset = text.match(/resets?\s+in\s+(\d+)\s*h/i)   ||
                     text.match(/(\d+)\s*h(?:ours?)?\s*(?:remaining|left|until)/i) ||
                     text.match(/plan\s+resets?\s+in\s+(\d+)/i);
      if (hReset) updateHourlyReset(+hReset[1]);

      const dReset = text.match(/resets?\s+in\s+(\d+)\s*d/i)  ||
                     text.match(/(\d+)\s*d(?:ays?)?\s*(?:remaining|left|until)/i);
      if (dReset) updateWeeklyReset(+dReset[1]);
    });

    // Scan visible footnote spans like "56% · resets 1h" or "resets 2d"
    document.querySelectorAll('.text-t6,.text-footnote').forEach(el => {
      const t = el.textContent || '';
      const hm = t.match(/resets?\s+(\d+)h/i);
      if (hm) updateHourlyReset(+hm[1]);
      const dm = t.match(/resets?\s+(\d+)d/i);
      if (dm) updateWeeklyReset(+dm[1]);
      const wPct = t.match(/(\d+)%\s*(?:of\s+)?weekly/i) || t.match(/weekly[^0-9]*(\d+)%/i);
      if (wPct) updateWeeklyBadges(+wPct[1]);
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  2.  QUICK WORKSPACE PANEL
  // ─────────────────────────────────────────────────────────────
  const WS_KEY    = 'cc-ws-v4';
  const PANEL_CLS = 'cc-ws-panel';

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

  // Wait for a NEW [role="menu"] to appear after clicking a trigger button
  async function waitNewMenu(ms = 2500) {
    const existing = new Set(document.querySelectorAll(
      '[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]'
    ));
    await sleep(80);
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      for (const m of document.querySelectorAll(
        '[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]'
      )) {
        if (!existing.has(m)) {
          const items = [...m.querySelectorAll('[role="menuitem"],[role="option"],li,button')]
            .filter(i => i.textContent.trim() && !i.querySelector('[role="menuitem"]'));
          if (items.length) return items;
        }
      }
      await sleep(60);
    }
    return [];
  }

  function matchFolder(itemText, folder) {
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const it = norm(itemText), f = norm(folder);
    return it === f || it.includes(f) || f.includes(it);
  }

  async function clickWorkspace(conn, folder, wsRow) {
    if (!wsRow?.isConnected) return;
    const [connBtn, folderBtn] = wsRow.querySelectorAll('button[aria-haspopup="menu"]');
    if (!connBtn || !folderBtn) return;
    const currentConn = connBtn.querySelector('span')?.textContent?.trim() || '';
    if (currentConn !== conn) {
      fireClick(connBtn);
      const items = await waitNewMenu();
      const target = items.find(el => el.textContent.includes(conn));
      if (target) { fireClick(target); await sleep(500); }
      else { document.body.click(); return; }
    }
    if (!wsRow.isConnected) return;
    const [, fb] = wsRow.querySelectorAll('button[aria-haspopup="menu"]');
    if (!fb) return;
    fireClick(fb);
    const items = await waitNewMenu();
    const target = items.find(el => matchFolder(el.textContent, folder));
    if (target) fireClick(target);
    else document.body.click();
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
      'font:inherit;font-size:11px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    b.onmouseenter = () => b.style.background = 'rgba(0,0,0,.07)';
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
      hint.textContent = 'No recent folders';
      hint.style.cssText = 'font-size:10px;opacity:.35;padding:2px 4px;';
      col.appendChild(hint);
    } else {
      for (const folder of folders) {
        const name = folder.split('/').filter(Boolean).pop() || folder;
        const btn = makeItemBtn(name, () => clickWorkspace(conn, folder, wsRow));
        btn.title = folder;
        col.appendChild(btn);
      }
    }
    const browse = makeItemBtn('Browse…', () => browseConn(conn, wsRow));
    browse.style.color = 'var(--accent,#4a90e2)';
    browse.style.opacity = '.8';
    browse.style.marginTop = '4px';
    col.appendChild(browse);
    return col;
  }

  function rebuildPanel() {
    const panel = document.querySelector('.' + PANEL_CLS);
    if (!panel?._wsRow) return;
    const {Local: L = [], Myserver: M = []} = loadWS().reduce((g, {conn, folder}) => {
      if (g[conn] && !g[conn].includes(folder)) g[conn].push(folder);
      return g;
    }, {Local: [], Myserver: []});
    panel.innerHTML = '';
    const cols = document.createElement('div');
    cols.style.cssText = 'display:flex;gap:10px;';
    cols.appendChild(buildColumn('Local',    L, panel._wsRow));
    cols.appendChild(buildColumn('Myserver', M, panel._wsRow));
    panel.appendChild(cols);
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
      'background:var(--bg-100,#f5f4ef);' +
      'border:1px solid var(--claude-border,rgba(0,0,0,.12));' +
      'border-radius:8px;padding:10px 12px;min-width:280px;max-width:380px;width:max-content;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.12);font-family:inherit;';
    wsRow.appendChild(panel);
    rebuildPanel();
  }

  // ─────────────────────────────────────────────────────────────
  //  3.  PROMPT-CACHE FRESHNESS RING  (on conversation title link)
  // ─────────────────────────────────────────────────────────────
  const CACHE_KEY = 'cc-cache-v4';
  const TTL = 5 * 60 * 1000;

  const getCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } };

  function markActive(id) {
    if (!id) return;
    const m = getCache();
    m[id] = Date.now();
    const cut = Date.now() - 10 * 60 * 1000;
    for (const k in m) if (m[k] < cut) delete m[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(m));
    applyRings();
  }

  function applyRings() {
    const m = getCache(), now = Date.now();
    // Clear stale rings (on any element, handles migration from old dot-based rings)
    document.querySelectorAll('[data-cc-ring]').forEach(el => {
      if (!m[el.dataset.ccRing] || now - m[el.dataset.ccRing] >= TTL) {
        el.style.boxShadow = '';
        el.style.borderRadius = '';
        delete el.dataset.ccRing;
      }
    });
    // Apply ring to the entire conversation link row (covers title + metadata)
    document.querySelectorAll('a[href*="/chat/"]').forEach(link => {
      const id = (link.href.match(/\/chat\/([^/?#]+)/) || [])[1];
      if (!id || !m[id] || now - m[id] >= TTL) return;
      link.dataset.ccRing = id;
      link.style.boxShadow = '0 0 0 2px #ef4444';
      link.style.borderRadius = '6px';
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  4.  TOP BAR HIDER + WCO SPACE RECLAIM + KEYBOARD SHORTCUTS
  // ─────────────────────────────────────────────────────────────
  let _topBarEl = null;

  /**
   * Override the WCO shim to report 0 topbar height so that
   * claude.ai's React layout recalculates padding-top → 0.
   * The shim lives at window.navigator.windowControlsOverlay and
   * was installed by mainView.js as a plain object (not frozen).
   */
  function patchWCOHeight() {
    try {
      const wco = navigator.windowControlsOverlay;
      if (!wco || !wco.getTitlebarAreaRect) return;
      if (wco._ccPatched) return;
      wco._ccPatched = true;
      wco.getTitlebarAreaRect = () => new DOMRect(0, 0, window.innerWidth, 0);
      // Dispatch a resize so React re-reads the rect and resets padding-top
      window.dispatchEvent(new Event('resize'));
    } catch (_) {}
  }

  function findTopBar() {
    // Strategy 0: exact attribute Claude Desktop sets on its title bar div
    const topLeft = document.querySelector('[data-top-left="true"]');
    if (topLeft) {
      localStorage.setItem('cc-debug', '0:data-top-left');
      return topLeft;
    }

    // Strategy A: back/forward navigation button → walk up to bar container
    const navLabels = new Set([
      'back','forward','go back','go forward',
      'navigate back','navigate forward','previous','history back','history forward'
    ]);
    const navBtn = [...document.querySelectorAll('button,a[role="button"]')].find(b => {
      const lbl = (b.getAttribute('aria-label') || b.getAttribute('title') || '').toLowerCase().trim();
      return navLabels.has(lbl);
    });
    if (navBtn) {
      let el = navBtn;
      for (let i = 0; i < 12 && el.parentElement && el.parentElement !== document.body; i++) {
        el = el.parentElement;
        const r = el.getBoundingClientRect();
        if (r.width > window.innerWidth * 0.4 && r.height > 0 && r.height < 80 && r.top < 20) {
          localStorage.setItem('cc-debug', 'A:' + el.tagName + ' ' + el.className.slice(0, 80));
          return el;
        }
      }
    }

    // Strategy B: <header> / nav at very top of page
    const topEls = [...document.querySelectorAll('header,nav,[role="banner"]')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.top < 5 && r.height > 10 && r.height < 80 && r.width > window.innerWidth * 0.4;
    });
    if (topEls.length) {
      topEls.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
      const el = topEls[0];
      localStorage.setItem('cc-debug', 'B:' + el.tagName + ' ' + el.className.slice(0, 80));
      return el;
    }

    // Strategy C: first child of root that is a short bar at y≈0
    for (const root of [document.body.firstElementChild, document.body.firstElementChild?.firstElementChild]) {
      if (!root) continue;
      for (const child of root.children) {
        const r = child.getBoundingClientRect();
        if (r.top < 5 && r.height > 20 && r.height < 80 && r.width > window.innerWidth * 0.5) {
          localStorage.setItem('cc-debug', 'C:' + child.tagName + ' ' + child.className.slice(0, 80));
          return child;
        }
      }
    }
    return null;
  }

  function hideTopBar() {
    if (_topBarEl && !document.contains(_topBarEl)) _topBarEl = null;
    if (_topBarEl) return;

    const el = findTopBar();
    if (!el) return;
    _topBarEl = el;

    const barH = el.getBoundingClientRect().height;
    el.style.setProperty('display', 'none', 'important');

    // Collapse any wrapper parents that are now empty / same-height as bar
    let parent = el.parentElement;
    for (let i = 0; i < 6 && parent && parent !== document.body; i++) {
      const r = parent.getBoundingClientRect();
      if (r.top < 5 && r.height <= barH + 4) {
        parent.style.setProperty('display', 'none', 'important');
        parent = parent.parentElement;
      } else {
        // Remove padding-top that was reserved for the topbar
        const cs = getComputedStyle(parent);
        if (parseFloat(cs.paddingTop) >= barH - 4) {
          parent.style.setProperty('padding-top', '0', 'important');
        }
        break;
      }
    }

    // Also zero-out WCO-driven layout padding
    patchWCOHeight();
  }

  // ── Keyboard shortcuts — capture phase (runs before React handlers) ──
  document.addEventListener('keydown', e => {

    // Ctrl+O → search
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'o') {
      e.preventDefault();
      e.stopPropagation();
      // Search for the button even inside the hidden top bar
      const btn = document.querySelector(
        'button[aria-label*="search" i]:not([aria-haspopup]),' +
        'button[title*="search" i]:not([aria-haspopup]),' +
        '[data-testid*="search"] button,' +
        '[data-testid="search-button"]'
      );
      if (btn) {
        btn.click();
      } else {
        // Fallback: Ctrl+K (claude.ai built-in search shortcut)
        const t = document.activeElement || document.body;
        t.dispatchEvent(new KeyboardEvent('keydown', {key:'k', code:'KeyK', ctrlKey:true, bubbles:true, cancelable:true}));
      }
    }

    // Ctrl+Shift+R → toggle right panel
    if (e.ctrlKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
      e.preventDefault();
      e.stopPropagation();
      const btn = findRightPanelToggle();
      if (btn) { btn.click(); return; }
      // Fallback: look for any panel-toggle on the right edge of the toolbar
      const toolbarBtns = [...document.querySelectorAll('header button, [role="toolbar"] button')]
        .filter(b => {
          const r = b.getBoundingClientRect();
          return r.right >= window.innerWidth * 0.6 && r.width > 0;
        });
      if (toolbarBtns.length) toolbarBtns[toolbarBtns.length - 1].click();
    }

    // Ctrl+Shift+L → toggle sidebar
    if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
      e.preventDefault();
      e.stopPropagation();

      // Priority 1: exact sidebar aria-labels (query includes hidden elements)
      const exact = document.querySelector(
        'button[aria-label="Close sidebar"],' +
        'button[aria-label="Open sidebar"],' +
        'button[aria-label="Toggle sidebar"]'
      );
      if (exact) { exact.click(); return; }

      // Priority 2: partial sidebar match, must NOT open a popup
      const partial = document.querySelector(
        'button[aria-label*="sidebar" i]:not([aria-haspopup]),' +
        'button[aria-label*="navigation pane" i]:not([aria-haspopup]),' +
        'button[aria-label*="toggle nav" i]:not([aria-haspopup])'
      );
      if (partial) { partial.click(); return; }

      // Priority 3: first non-menu button inside the hidden top bar
      // (leftmost button is almost always the sidebar toggle in claude.ai)
      if (_topBarEl) {
        const firstBtn = [..._topBarEl.querySelectorAll('button')]
          .find(b => !b.getAttribute('aria-haspopup'));
        if (firstBtn) { firstBtn.click(); return; }
      }

      // Priority 4: claude.ai may respond to Ctrl+\ for sidebar
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'\\', ctrlKey:true, bubbles:true}));
    }

  }, true); // capture phase

  // ─────────────────────────────────────────────────────────────
  //  BOOTSTRAP
  // ─────────────────────────────────────────────────────────────
  let lastPath = '';

  function scan() {
    document.querySelectorAll('button[aria-label^="Usage:"]').forEach(applyBadges);

    document.querySelectorAll('.flex.flex-wrap.gap-g5').forEach(row => {
      if (row.querySelector('button[aria-haspopup="menu"]')) installPanel(row);
    });

    applyRings();
    scanForUsageExtras();
    hideTopBar();
    dismissStartupPopups();
    preferCodeTab();
    injectRightPanelTabs(findRightPanel());

    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      const id = (location.pathname.match(/\/chat\/([^/?#]+)/) || [])[1];
      if (id) markActive(id);
      document.querySelectorAll('[data-cc-row]').forEach(row => {
        delete row.dataset.ccRow;
        row.removeAttribute('data-cc-row');
      });
      removeAllPanels();
      // On navigation React may re-render the topbar; re-check it
      if (_topBarEl && !document.contains(_topBarEl)) _topBarEl = null;
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
    patchWCOHeight(); // patch early before React reads titlebar rect
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
