/**
 * Claude Desktop custom UI — v8
 *
 * Features:
 *  1. Text usage badges:  C35%  H81%  2h  W45%  3d
 *     C=blue(context)  H=yellow(hourly)  2h=white(hrs to reset)
 *     W=green(weekly)  3d=white(days to reset)
 *  2. Quick workspace panel — two columns LOCAL | MYSERVER (hover-triggered)
 *     Hovering a Local folder previews its TODO.md (baked at build time)
 *  3. Prompt-cache freshness ring on sidebar conversation titles
 *     amber outline + tinted bg; outline is not clipped by overflow:hidden
 *  4. Top bar hidden; WCO height overridden to 0 to reclaim the space
 *     Ctrl+O = search    Ctrl+Shift+L = toggle sidebar
 *     Ctrl+1/2/3 = Chat / Cowork / Code
 *     Ctrl+Shift+R = toggle right panel
 *     Ctrl+W = close file viewer / preview overlay (repurposed; native Ctrl+W = redundant new session)
 *     Alt+1-9 = jump to Nth chat in sidebar
 *  5. Chat number badges (1-9) on first 9 sidebar chats
 *  6. New-session page overview/activity section hidden (not useful)
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
      // ── dframe layout: kill leftover padding-top, fix sidebar height
      '#dframe-main,.dframe-content{padding-top:0!important;margin-top:0!important}',
      '.dframe-sidebar{min-height:100%!important;align-self:stretch!important;height:auto!important}',
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
      // ── Cache ring: inline styles applied directly in applyRings() — outline is not clipped by overflow:hidden
      // ── Pin feature
      'a[data-cc-pinned]{outline:2px solid #f59e0b!important;outline-offset:-2px!important;border-radius:6px!important;}',
      '.cc-pin-host{position:relative!important;}',
      '.cc-pin-btn{display:none;position:absolute;right:3px;top:50%;transform:translateY(-50%);' +
        'background:none;border:0;cursor:pointer;font-size:11px;opacity:.45;z-index:10;padding:2px 4px;line-height:1;}',
      '.cc-pin-host:hover .cc-pin-btn,.cc-pin-btn[data-pinned]{display:inline-block!important;}',
      '.cc-pin-btn[data-pinned]{opacity:.8;color:#f59e0b;}',
      '.cc-pin-btn:hover{opacity:1!important;}',
      // ── Workspace panel: dark-mode override (inline styles can't use prefers-color-scheme)
      '@media (prefers-color-scheme:dark){' +
        '.cc-ws-panel{background:#28261f!important;border-color:rgba(255,255,255,.12)!important;}' +
        '.cc-ws-panel button{color:inherit!important;}' +
      '}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────────────────────
  //  0b. "MODEL UNAVAILABLE" BANNER HIDER
  // ─────────────────────────────────────────────────────────────
  // Tracks already-hidden banners so we don't re-check them on every scan.
  const _hiddenBanners = new WeakSet();

  function hideUnavailableBanners() {
    // Query likely notification containers — far cheaper than a full TreeWalker.
    // Never hide anything taller than 15% of the viewport — that's page content.
    document.querySelectorAll('[role="alert"],[role="status"],[role="banner"],[aria-live]').forEach(el => {
      if (_hiddenBanners.has(el)) return;
      if (!/is currently unavailable/i.test(el.textContent)) return;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < window.innerHeight * 0.15 && r.width > window.innerWidth * 0.3) {
        _hiddenBanners.add(el);
        el.style.setProperty('display', 'none', 'important');
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  0c. STARTUP POPUP DISMISSER
  // ─────────────────────────────────────────────────────────────
  const _seenDialogs = new WeakSet();

  function dismissStartupPopups() {
    // ── "Attach X to this session?" — search by button text, regardless of dialog role
    if (!_seenDialogs._attachDismissed) {
      const allBtns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      const cancelBtn = allBtns.find(b => (b.textContent || '').toLowerCase().trim() === 'cancel');
      const attachBtn = allBtns.find(b => (b.textContent || '').toLowerCase().trim() === 'attach');
      if (cancelBtn && attachBtn) {
        _seenDialogs._attachDismissed = true;
        setTimeout(() => { if (document.contains(cancelBtn)) cancelBtn.click(); }, 200);
      }
    }

    // ── role="dialog" / role="alertdialog" popups
    document.querySelectorAll('[role="dialog"],[role="alertdialog"]').forEach(d => {
      if (_seenDialogs.has(d)) return;
      _seenDialogs.add(d);
      const btns = [...d.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      const labels = btns.map(b => (b.textContent || '').toLowerCase().trim());

      // ── Single-button "OK / Got it" popups — auto-accept
      if (btns.length !== 1) return;
      const lbl = labels[0];
      const autoDismiss = ['ok','got it','dismiss','continue','close','done','accept']
        .some(w => lbl.includes(w));
      if (autoDismiss) {
        setTimeout(() => { if (document.contains(btns[0])) btns[0].click(); }, 300);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  0d. NEW-SESSION OVERVIEW HIDER
  //  The home page shows an "activity overview" section (git-like
  //  heatmap / usage stats) that obscures the workspace panel.
  //  Hide it on all non-chat pages; it can be re-shown by setting
  //  localStorage.ccShowOverview = '1'.
  // ─────────────────────────────────────────────────────────────
  function hideNewSessionOverview() {
    if (location.pathname.includes('/chat/')) return;
    if (localStorage.getItem('ccShowOverview') === '1') return;

    // Selectors that match overview/activity/stats blocks
    const OV_SEL = [
      '[data-testid*="overview" i]',
      '[data-testid*="activity" i]',
      '[data-testid*="stats" i]',
      '[data-testid*="chart" i]',
      '[aria-label*="activity" i]',
      '[aria-label*="overview" i]',
      'canvas',
    ].join(',');

    document.querySelectorAll(OV_SEL).forEach(el => {
      if (el.dataset.ccOvHidden) return;
      // Walk up to a container that can be hidden without touching the workspace row or inputs
      let target = el;
      for (let i = 0; i < 6; i++) {
        const p = target.parentElement;
        if (!p || p === document.body || p === document.documentElement) break;
        if (p.querySelector('button[aria-haspopup="menu"],textarea,input[type="text"]')) break;
        const r = p.getBoundingClientRect();
        if (r.height > window.innerHeight * 0.5) break;
        target = p;
      }
      target.dataset.ccOvHidden = '1';
      target.style.setProperty('display', 'none', 'important');
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  0e. DEFAULT TO "CODE" TAB IN ARTIFACT PANEL
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
          const name = emojiSuffix(folder.split('/').filter(Boolean).pop() || folder);
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
  //  1.  USAGE BADGES   C35%  H5%  2h  W44%  3d
  // ─────────────────────────────────────────────────────────────
  //
  // Data sources:
  //   ctx, plan  ← button aria-label ("Usage: context X%, plan Y%")
  //               'plan' = weekly plan usage in current Claude Desktop
  //   _hourlyPct, _weeklyPct, _hourlyResetMs, _weeklyResetMs ← popup scan (persisted)
  //
  let _ctxPct          = null;   // context window % (from usage button)
  let _weeklyPct       = null;   // weekly plan % (from popup)
  let _hourlyPct       = null;   // 5-hour plan % (from popup)
  let _hourlyResetMs   = null;   // absolute ms timestamp of next hourly reset
  let _weeklyResetMs   = null;   // absolute ms timestamp of next weekly reset
  const _badgeRebuild  = new WeakMap(); // btn → rebuild fn

  // Derive display values live from stored timestamps so they age correctly.
  function hoursUntil(ms) { return ms && ms > Date.now() ? Math.ceil((ms - Date.now()) / 3600000) : null; }
  function daysUntil(ms)  { return ms && ms > Date.now() ? Math.ceil((ms - Date.now()) / 86400000) : null; }

  const RESET_STORE = 'cc-reset-v1';
  function saveResetTimes() {
    try {
      localStorage.setItem(RESET_STORE, JSON.stringify({
        hourly: _hourlyResetMs, weekly: _weeklyResetMs
      }));
    } catch(e) {}
  }
  function loadResetTimes() {
    try {
      const d = JSON.parse(localStorage.getItem(RESET_STORE) || '{}');
      const now = Date.now();
      if (d.hourly && d.hourly > now) _hourlyResetMs = d.hourly;
      if (d.weekly && d.weekly > now) _weeklyResetMs = d.weekly;
    } catch(e) {}
  }

  // Colored-letter badge: C35%  H5%  W44%
  function pctBadge(letter, pct, color, title) {
    const dim = pct == null;
    return `<span title="${title}${dim ? '' : ': ' + pct + '%'}"` +
      ` style="opacity:${dim ? 0.35 : 1};font-size:10px;font-weight:600;` +
      `white-space:nowrap;font-variant-numeric:tabular-nums;letter-spacing:-0.01em;">` +
      `<span style="color:${color}">${letter}${dim ? '--' : pct}%</span></span>`;
  }

  // Time-remaining badge: 2h  3d — omitted entirely when unknown
  function timeBadge(val, unit, title) {
    if (val == null) return '';
    return `<span title="${title}: ${val}${unit}"` +
      ` style="opacity:0.6;font-size:10px;font-weight:500;` +
      `white-space:nowrap;font-variant-numeric:tabular-nums;letter-spacing:-0.01em;">` +
      `${val}${unit}</span>`;
  }

  // Parse the button's aria-label — pure, no side-effects
  function parseUsage(label) {
    const get = re => { const m = label.match(re); return m ? +m[1] : null; };
    return {
      ctx:  get(/context\s+(\d+)%/i),
      plan: get(/plan\s+(\d+)%/i),   // = weekly plan in current Claude Desktop
    };
  }

  function buildBadges(ctx, plan) {
    return pctBadge('C', ctx,                '#3b82f6', 'Context window') +
           pctBadge('H', _hourlyPct,         '#f59e0b', '5-hour plan')    +
           timeBadge(hoursUntil(_hourlyResetMs), 'h', 'Resets in')        +
           pctBadge('W', _weeklyPct ?? plan, '#22c55e', 'Weekly plan')    +
           timeBadge(daysUntil(_weeklyResetMs),  'd', 'Resets in');
  }

  function applyBadges(btn) {
    if (btn.dataset.ccV4) return;
    btn.dataset.ccV4 = '1';
    const orig = btn.querySelector('svg');
    if (!orig) return;
    const wrap = document.createElement('span');
    wrap.style.cssText = 'display:inline-flex;gap:4px;align-items:center;';
    const rebuild = lbl => {
      const {ctx, plan} = parseUsage(lbl);
      if (ctx != null) _ctxPct = ctx;        // make ctx globally available
      wrap.innerHTML = buildBadges(ctx, plan);
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
    updateFloatingBar();
  }

  // Setters — only re-render when value actually changes
  function setWeeklyPct(v)      { if (_weeklyPct    !== v) { _weeklyPct    = v; refreshBadges(); } }
  function setHourlyPct(v)      { if (_hourlyPct    !== v) { _hourlyPct    = v; refreshBadges(); } }
  function setHourlyReset(ms)   { if (_hourlyResetMs !== ms) { _hourlyResetMs = ms; saveResetTimes(); refreshBadges(); } }
  function setWeeklyReset(ms)   { if (_weeklyResetMs !== ms) { _weeklyResetMs = ms; saveResetTimes(); refreshBadges(); } }

  // Parse "Resets Wed 1:39 AM" / "Resets Today 9:59 AM" → absolute ms timestamp.
  function resetTimestamp(str) {
    const m = str.match(/Resets?\s+(\w+)\s+(\d+):(\d+)\s*(AM|PM)/i);
    if (!m) return null;
    const [, dayStr, hStr, minStr, ampm] = m;
    let h = +hStr, min = +minStr;
    if (ampm.toUpperCase() === 'PM' && h !== 12) h += 12;
    if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;

    const now    = new Date();
    const target = new Date(now);
    target.setHours(h, min, 0, 0);

    const dl = dayStr.toLowerCase();
    if (dl === 'today') {
      if (target <= now) target.setDate(target.getDate() + 1);
    } else if (dl === 'tomorrow') {
      target.setDate(target.getDate() + 1);
    } else {
      const DOW = ['sun','mon','tue','wed','thu','fri','sat'];
      const td = DOW.findIndex(d => dl.startsWith(d));
      if (td === -1) return null;
      let ahead = td - now.getDay();
      if (ahead < 0 || (ahead === 0 && target <= now)) ahead += 7;
      target.setDate(now.getDate() + ahead);
    }

    return target.getTime();
  }

  // Scan popup/dialog elements for usage data not available in the aria-label.
  // Uses document.body.innerText (visible text only) so it catches any popup
  // regardless of Radix/DOM nesting — no selector guessing needed.
  //
  // Popup format (as of current Claude Desktop):
  //   Context window
  //   56.4k / 200.0k (28%)
  //   Plan usage
  //   5-hour limit
  //   Resets Wed 1:39 AM
  //   6%
  //   Weekly · all models
  //   Resets Wed 9:59 AM
  //   83%
  function scanForUsageExtras() {
    // Only worth scanning when a popup/overlay is visibly open
    const hasPopup = !!document.querySelector(
      '[data-state="open"],[role="dialog"],[role="tooltip"],[data-radix-popper-content-wrapper]'
    );
    if (!hasPopup) return;

    // innerText respects CSS visibility — hidden/closed popups are excluded
    const t = document.body.innerText || '';
    if (!t.includes('5-hour') && !t.includes('5 hour') && !t.includes('Weekly')) return;

    // 5-hour %  — first \d+% that follows "5-hour" within 200 chars
    const h5Pct = t.match(/5.hour[^]{0,200}?(\d+)%/i);
    if (h5Pct) setHourlyPct(+h5Pct[1]);

    // Weekly %  — first \d+% that follows "weekly" within 200 chars
    const wkPct = t.match(/week(?:ly)?[^]{0,200}?(\d+)%/i);
    if (wkPct) setWeeklyPct(+wkPct[1]);

    // 5-hour reset — "Resets <day> <time>" that follows "5-hour" within 200 chars
    const h5Rst = t.match(/5.hour[^]{0,200}?(Resets?\s+\w+\s+\d+:\d+\s*(?:AM|PM))/i);
    if (h5Rst) {
      const ms = resetTimestamp(h5Rst[1]);
      if (ms) setHourlyReset(ms);
    }

    // Weekly reset — "Resets <day> <time>" that follows "weekly" within 200 chars
    const wkRst = t.match(/week(?:ly)?[^]{0,200}?(Resets?\s+\w+\s+\d+:\d+\s*(?:AM|PM))/i);
    if (wkRst) {
      const ms = resetTimestamp(wkRst[1]);
      if (ms) setWeeklyReset(ms);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  1b. EMOJI SUFFIX HELPER
  //  Folder names are stored with emoji PREFIXES (e.g. "⏱️ Time Management")
  //  but displayed with the emoji moved to the END ("Time Management ⏱️")
  //  so the text sorts/scans more naturally.
  // ─────────────────────────────────────────────────────────────
  function emojiSuffix(name) {
    // Move any leading non-letter/non-digit chars (emoji, symbols, spaces) to the end.
    // Unicode property escapes: \p{L}=letter, \p{N}=number (requires 'u' flag).
    const m = name.match(/^([^\p{L}\p{N}]+)([\p{L}\p{N}].*)$/su);
    if (!m) return name;          // all emoji / no text — leave untouched
    return m[2].trimEnd() + ' ' + m[1].trim();
  }

  // ─────────────────────────────────────────────────────────────
  //  2.  QUICK WORKSPACE PANEL
  // ─────────────────────────────────────────────────────────────
  const WS_KEY    = 'cc-ws-v4';
  const PANEL_CLS = 'cc-ws-panel';

  // Build-time snapshot of each folder's TODO.md, keyed by full path (see update-ui.sh).
  const CC_TODOS = (typeof CC_AI_TODOS !== 'undefined') ? CC_AI_TODOS : {};

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
  const _ITEM_SEL = '[role="menuitem"],[role="option"],[role="radio"],[role="checkbox"],' +
    '[data-cmdk-item],[cmdk-item],[data-radix-collection-item],li,button';

  // Wait for a NEW popup/menu to appear after clicking a trigger button
  async function waitNewMenu(ms = 2500) {
    const existing = new Set(document.querySelectorAll(_MENU_SEL));
    await sleep(80);
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      for (const m of document.querySelectorAll(_MENU_SEL)) {
        if (!existing.has(m)) {
          const items = [...m.querySelectorAll(_ITEM_SEL)]
            .filter(i => i.textContent.trim() && !i.querySelector('[role="menuitem"],[role="option"]'));
          if (items.length) return items;
        }
      }
      await sleep(60);
    }
    return [];
  }

  function matchFolder(itemText, folder) {
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Compare against the basename only, not the full path
    const name = folder.split('/').filter(Boolean).pop() || folder;
    const it = norm(itemText), f = norm(name);
    return it === f || it.includes(f) || f.includes(it);
  }

  // Call React's own event handlers directly via the fiber tree.
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

  // Find the two workspace buttons: [connectionBtn, folderBtn]
  function findWsBtns(wsRow) {
    const menuBtns = [...wsRow.querySelectorAll('button[aria-haspopup="menu"]')];
    if (menuBtns.length >= 2) return [menuBtns[0], menuBtns[1]];
    // Fallback: connection button only — folder button may lack aria-haspopup
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
      const connTarget = connItems.find(el => el.textContent.trim().includes(conn));
      if (!connTarget) { console.log('[cc-ws] conn target not found'); document.body.click(); return; }
      fireClick(connTarget);
      await sleep(600);
      // SSH connection may trigger an env-selector dialog — auto-pick if single option
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(d => d.offsetParent && !_seenDialogs.has(d));
      if (dialog) {
        const opts = [...dialog.querySelectorAll('[role="option"],li,button')]
          .filter(el => el.textContent.trim() && el.offsetParent);
        if (opts.length === 1) { fireClick(opts[0]); await sleep(400); }
        else return; // Multiple SSH profiles — let user choose
      }
    }

    if (!wsRow.isConnected) { console.log('[cc-ws] wsRow disconnected after conn switch'); return; }
    const [, fb] = findWsBtns(wsRow);
    if (!fb) { console.log('[cc-ws] folder button gone after conn switch'); return; }

    console.log('[cc-ws] clicking folder button');
    fireClick(fb);
    const folderItems = await waitNewMenu();
    console.log('[cc-ws] folder menu items:', folderItems.map(i => i.textContent.trim()));
    // Also check data-value attribute on items (Radix Select sets this)
    const folderTarget = folderItems.find(el => {
      const val = el.getAttribute('data-value') || el.getAttribute('value') || '';
      if (val && matchFolder(val, folder)) return true;
      return matchFolder(el.textContent, folder);
    });
    localStorage.setItem('cc-ws-debug', JSON.stringify({
      ts: Date.now(), folder, found: !!folderTarget,
      items: folderItems.map(i => ({t: i.textContent.trim().slice(0,30), v: i.getAttribute('data-value')||'', r: i.getAttribute('role')||''})),
    }));
    if (folderTarget) {
      folderTarget.scrollIntoView({block: 'nearest'});
      await sleep(30);

      // Approach 1: React fiber handler — bypasses isTrusted restrictions
      if (tryFiberClick(folderTarget)) { await sleep(150); return; }

      // Approach 2: Keyboard navigation — Home then ArrowDown×N then Enter.
      // Radix Select's keyboard handler lives on the listbox/document and does NOT
      // check isTrusted for keydown, so synthetic keyboard events work where pointer
      // events don't.
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
        await sleep(150);
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
    document.body.click(); // nothing found — close the menu
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
      // Two-column grid when list is long enough to warrant it
      if (folders.length > 4) {
        grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:1px 4px;';
      }
      for (const folder of folders) {
        const name = emojiSuffix(folder.split('/').filter(Boolean).pop() || folder);
        const btn = makeItemBtn(name, () => clickWorkspace(conn, folder, wsRow));
        btn.title = folder;
        if (conn === 'Local' && CC_TODOS[folder]) {
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

  // Shared TODO.md preview pane; updated as folder buttons are hovered.
  let _todoPreviewEl = null;
  function showTodoPreview(folder) {
    if (!_todoPreviewEl) return;
    const text = CC_TODOS[folder];
    if (!text) { _todoPreviewEl.style.display = 'none'; return; }
    const name = emojiSuffix(folder.split('/').filter(Boolean).pop() || folder);
    _todoPreviewEl.style.display = '';
    _todoPreviewEl.firstChild.textContent = name + ' — TODO.md';
    _todoPreviewEl.lastChild.textContent = text;   // .textContent — never innerHTML
  }

  function rebuildPanel() {
    const panel = document.querySelector('.' + PANEL_CLS);
    if (!panel?._wsRow) return;
    const ws = loadWS();
    // Prefer runtime list (from cc-folders.json read by preload at page-load time),
    // fall back to baked CC_AI_LOCAL list, fall back to localStorage recents.
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

    // TODO.md preview pane — hidden until a Local folder with a baked TODO is hovered.
    const preview = document.createElement('div');
    preview.style.cssText = 'display:none;margin-top:10px;padding-top:8px;' +
      'border-top:1px solid var(--claude-border,rgba(128,128,128,.22));';
    const phdr = document.createElement('div');
    phdr.style.cssText = 'font-size:10px;font-weight:600;opacity:.55;text-transform:uppercase;' +
      'letter-spacing:.05em;margin-bottom:5px;';
    const pbody = document.createElement('pre');
    pbody.style.cssText = 'margin:0;font-size:11px;line-height:1.4;white-space:pre-wrap;' +
      'word-break:break-word;max-height:240px;overflow:auto;opacity:.85;font-family:inherit;';
    preview.appendChild(phdr);
    preview.appendChild(pbody);
    panel.appendChild(preview);
    _todoPreviewEl = preview;
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
      'display:none;' +  // hidden until hover
      'background:var(--bg-100,#f5f4ef);' +
      'border:1px solid var(--claude-border,rgba(128,128,128,.22));' +
      'border-radius:8px;padding:10px 12px;min-width:320px;max-width:480px;width:max-content;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.16);font-family:inherit;';
    wsRow.appendChild(panel);
    rebuildPanel();

    // Show on hover of the workspace row or panel itself; hide when both are left
    const showPanel = () => { panel.style.display = ''; };
    const hidePanel = () => {
      setTimeout(() => {
        if (!wsRow.matches(':hover') && !panel.matches(':hover')) panel.style.display = 'none';
      }, 150);
    };
    wsRow.addEventListener('mouseenter', showPanel);
    panel.addEventListener('mouseenter', showPanel);
    wsRow.addEventListener('mouseleave', hidePanel);
    panel.addEventListener('mouseleave', hidePanel);
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
    const rl = loadRateLimits();

    // Clear any expired/invalid rings first
    document.querySelectorAll('[data-cc-ring]').forEach(el => {
      const id = el.dataset.ccRing;
      const isCached  = m[id] && now - m[id] < TTL;
      const isRateL   = rl[id];
      if (!isCached && !isRateL) {
        delete el.dataset.ccRing;
        el.style.removeProperty('outline');
        el.style.removeProperty('outline-offset');
        el.style.removeProperty('border-radius');
        el.style.removeProperty('background-color');
      }
    });

    // Apply to all chat/project links in the sidebar.
    // • Red   (#ef4444) = session hit "Too many requests"
    // • Amber (#f59e0b) = prompt cache likely still warm (within 5 min)
    // outline is NOT clipped by parent overflow:hidden; inline !important beats React styles.
    document.querySelectorAll('a[href*="/chat/"],a[href*="/project/"]').forEach(link => {
      const id = (link.href.match(/\/chat\/([^/?#]+)/) || [])[1];
      if (!id) return;
      if (rl[id]) {
        // Rate-limited — red ring (persistent until manually cleared)
        link.dataset.ccRing = id;
        link.style.setProperty('outline',          '2px solid #ef4444',     'important');
        link.style.setProperty('outline-offset',   '-1px',                  'important');
        link.style.setProperty('border-radius',    '6px',                   'important');
        link.style.setProperty('background-color', 'rgba(239,68,68,.12)',   'important');
      } else if (m[id] && now - m[id] < TTL) {
        // Cached — teal/cyan ring (distinct from Claude's own amber "needs action" dots)
        link.dataset.ccRing = id;
        link.style.setProperty('outline',          '2px solid #06b6d4',       'important');
        link.style.setProperty('outline-offset',   '-1px',                    'important');
        link.style.setProperty('border-radius',    '6px',                     'important');
        link.style.setProperty('background-color', 'rgba(6,182,212,.10)',     'important');
      } else if (link.dataset.ccRing) {
        delete link.dataset.ccRing;
        link.style.removeProperty('outline');
        link.style.removeProperty('outline-offset');
        link.style.removeProperty('border-radius');
        link.style.removeProperty('background-color');
      }
    });

    // One-time diagnostic: log the first chat links found (inspect via
    //   JSON.parse(localStorage.getItem('cc-ring-diag')) in the console)
    if (!window._ccRingDiag) {
      window._ccRingDiag = true;
      const links = [...document.querySelectorAll('a[href*="/chat/"]')].slice(0, 4);
      localStorage.setItem('cc-ring-diag', JSON.stringify({
        ts: Date.now(),
        found: links.length,
        links: links.map(l => ({href: l.getAttribute('href'), cls: l.className.slice(0,60)})),
        cacheKeys: Object.keys(getCache()),
        rlKeys:    Object.keys(rl),
        path:      location.pathname,
      }));
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  3b. CHAT PIN FEATURE
  //  Stores pinned chat IDs in cc-pins-v1 localStorage key.
  //  Shows amber outline on sidebar link; 📌 button reveals on hover.
  // ─────────────────────────────────────────────────────────────
  const PINS_KEY = 'cc-pins-v1';
  const loadPins = () => { try { return JSON.parse(localStorage.getItem(PINS_KEY) || '{}'); } catch { return {}; } };
  const savePins = p => localStorage.setItem(PINS_KEY, JSON.stringify(p));

  function togglePin(id, title) {
    const p = loadPins();
    if (p[id]) delete p[id]; else p[id] = {title, ts: Date.now()};
    savePins(p);
    applyPins();
  }

  function applyPins() {
    const p = loadPins();
    document.querySelectorAll('a[href*="/chat/"]').forEach(link => {
      const id = (link.href.match(/\/chat\/([^/?#]+)/) || [])[1];
      if (!id) return;
      if (p[id]) link.dataset.ccPinned = id;
      else delete link.dataset.ccPinned;
      // Sync the pin button indicator if it exists
      const btn = link.parentElement?.querySelector(':scope > .cc-pin-btn');
      if (btn) {
        if (p[id]) btn.setAttribute('data-pinned', '1');
        else btn.removeAttribute('data-pinned');
      }
    });
  }

  function setupPinBtns() {
    document.querySelectorAll('a[href*="/chat/"]').forEach(link => {
      const id = (link.href.match(/\/chat\/([^/?#]+)/) || [])[1];
      if (!id) return;
      const host = link.parentElement;
      if (!host || host.dataset.ccPinHost === id) return;
      host.dataset.ccPinHost = id;
      host.classList.add('cc-pin-host');
      // Remove stale pin button if chat id changed (React re-used the DOM node)
      const old = host.querySelector(':scope > .cc-pin-btn');
      if (old) old.remove();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cc-pin-btn';
      btn.title = 'Pin / unpin this chat';
      btn.textContent = '📌';
      btn.onclick = e => { e.preventDefault(); e.stopPropagation(); togglePin(id, link.textContent.trim()); };
      if (loadPins()[id]) btn.setAttribute('data-pinned', '1');
      host.appendChild(btn);
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  3c. RATE-LIMIT INDICATOR  (red ring in sidebar)
  //  When "Too many requests / temporarily limiting" text appears in the current
  //  chat, we tag that chat ID in cc-ratelimit localStorage.
  //  applyRings() then renders a red outline on that sidebar link.
  // ─────────────────────────────────────────────────────────────
  const RATELIMIT_KEY = 'cc-ratelimit';
  const loadRateLimits = () => {
    try { return JSON.parse(localStorage.getItem(RATELIMIT_KEY) || '{}'); } catch { return {}; }
  };

  function scanForRateLimit() {
    const id = (location.pathname.match(/\/chat\/([^/?#]+)/) || [])[1];
    if (!id) return;
    const rl = loadRateLimits();
    if (rl[id]) return; // already marked
    // Scan page text for rate-limit error messages
    // Use innerText so we only pick up visible text, not hidden React state
    const pageText = document.body?.innerText || '';
    if (/too many requests|temporarily limiting/i.test(pageText)) {
      rl[id] = Date.now();
      localStorage.setItem(RATELIMIT_KEY, JSON.stringify(rl));
      applyRings(); // re-render sidebar immediately
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  3d. SIDEBAR CHAT NUMBER BADGES  (1-9)
  //  Small dimmed numbers before each of the first 9 chat items.
  //  Alt+1-9 jumps to the Nth visible chat (see keyboard section).
  // ─────────────────────────────────────────────────────────────
  function applyChatNumbers() {
    // All visible chat links in the sidebar (not inside dialogs or panels)
    const links = [...document.querySelectorAll(
      'nav a[href*="/chat/"], [data-sidebar] a[href*="/chat/"], aside a[href*="/chat/"]'
    )].filter(el => el.offsetParent !== null && !el.closest('[role="dialog"],.cc-ws-panel'));

    links.forEach((link, i) => {
      const host = link.parentElement;
      if (!host) return;
      const n = i < 9 ? String(i + 1) : null;
      const existing = host.querySelector(':scope > .cc-chat-num');

      if (!n) { existing?.remove(); delete link.dataset.ccNum; return; }
      if (link.dataset.ccNum === n && existing) return; // already correct

      link.dataset.ccNum = n;
      if (existing) { existing.textContent = n; return; }

      const badge = document.createElement('span');
      badge.className = 'cc-chat-num';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = n;
      badge.style.cssText =
        'display:inline-flex;align-items:center;justify-content:center;' +
        'min-width:14px;height:14px;font-size:9px;font-weight:700;' +
        'opacity:.28;border-radius:3px;background:rgba(0,0,0,.08);' +
        'padding:0 2px;margin-right:3px;flex-shrink:0;pointer-events:none;' +
        'font-variant-numeric:tabular-nums;';
      // Insert before the link itself so it sits to its left
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.insertBefore(badge, link);
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

    // Ctrl+1/2/3 → switch main view: Chat / Cowork / Code
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
      const modes = ['chat', 'cowork', 'code'];
      const mode  = modes[+e.key - 1];
      // Search nav/sidebar elements for a button/link matching the mode name
      const candidates = [...document.querySelectorAll(
        'nav a,nav button,[role="navigation"] a,[role="navigation"] button,' +
        'aside a,aside button,[data-sidebar] a,[data-sidebar] button,' +
        '[role="complementary"] a,[role="complementary"] button'
      )];
      const target = candidates.find(el => {
        const lbl = (el.getAttribute('aria-label') || el.getAttribute('title') ||
                     el.textContent || el.dataset.testid || '').toLowerCase();
        return lbl.includes(mode);
      });
      if (target) {
        e.preventDefault(); e.stopPropagation();
        target.click();
      } else {
        // Fallback: navigate to the section URL
        const urls = {chat: '/', cowork: '/cowork', code: '/code'};
        if (location.pathname !== urls[mode]) {
          e.preventDefault(); e.stopPropagation();
          history.pushState({}, '', urls[mode]);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      }
    }

    // Ctrl+W → close file viewer / preview overlay
    // (Ctrl+W in Claude Desktop duplicates Ctrl+N → new session, so we repurpose it)
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'W' || e.key === 'w')) {
      // Try to find and close a visible file preview or dialog
      const closeBtn = (
        // Prefer a dialog close button
        document.querySelector('[role="dialog"]:not(.cc-ws-panel) button[aria-label*="close" i]') ||
        document.querySelector('[role="dialog"]:not(.cc-ws-panel) button[aria-label*="dismiss" i]') ||
        // Artifact panel close
        document.querySelector('button[data-testid*="close-artifact"],button[aria-label*="close artifact" i]') ||
        // Any visible close button that's not in nav/sidebar
        [...document.querySelectorAll('button[aria-label*="close" i],button[aria-label*="dismiss" i]')]
          .find(b => b.offsetParent && !b.closest('nav,aside,[data-sidebar],.cc-ws-panel'))
      );
      if (closeBtn) { e.preventDefault(); e.stopPropagation(); closeBtn.click(); }
    }

    // Alt+1-9 → jump to Nth chat in sidebar
    if (e.altKey && !e.ctrlKey && !e.shiftKey) {
      const n = parseInt(e.key, 10) || parseInt(e.code.replace('Digit',''), 10);
      if (n >= 1 && n <= 9) {
        const links = [...document.querySelectorAll('a[href*="/chat/"]')]
          .filter(el => el.offsetParent !== null && !el.closest('[role="dialog"],.cc-ws-panel'));
        const target = links[n - 1];
        if (target) { e.preventDefault(); e.stopPropagation(); target.click(); }
      }
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
  //  5.  FLOATING USAGE BAR — works on all pages, including Cowork
  // ─────────────────────────────────────────────────────────────
  //  A small fixed-position chip (top-right) that always shows
  //  C% H% W% regardless of whether the usage button exists in
  //  the current page layout (e.g. Cowork, Projects, etc.).
  //  Hidden while all three values are unknown; once any value
  //  lands it becomes visible and stays.
  // ─────────────────────────────────────────────────────────────
  const FBAR_ID  = 'cc-fbar';
  let   _fbarEl  = null;

  function fbarBadge(letter, pct, color) {
    // Identical visual language to pctBadge() but inline for the chip.
    if (pct == null) {
      return `<span style="opacity:.3;font-size:10px;font-weight:600;` +
             `font-variant-numeric:tabular-nums;">${letter}--</span>`;
    }
    return `<span style="color:${color};font-size:10px;font-weight:700;` +
           `font-variant-numeric:tabular-nums;">${letter}${pct}%</span>`;
  }

  function fbarTime(val, unit) {
    if (!val) return '';
    return `<span style="opacity:.5;font-size:10px;font-weight:500;">${val}${unit}</span>`;
  }

  function updateFloatingBar() {
    const anyKnown = _ctxPct != null || _hourlyPct != null || _weeklyPct != null;

    // Only show on Chat and Cowork (whitelist) — hide on Code and other pages
    const path = location.pathname;

    // Lazy-create the bar element
    if (!_fbarEl || !document.contains(_fbarEl)) {
      _fbarEl = document.getElementById(FBAR_ID);
      if (!_fbarEl) {
        _fbarEl = document.createElement('div');
        _fbarEl.id = FBAR_ID;
        _fbarEl.title = 'Usage: Context · Hourly · Weekly — click to dismiss';
        _fbarEl.style.cssText =
          'position:fixed;bottom:8px;right:8px;z-index:2147483647;' +
          'display:none;' + // shown once we have at least one value
          'gap:5px;align-items:center;' +
          'background:var(--bg-100,rgba(245,244,239,.95));' +
          'border:1px solid var(--claude-border,rgba(0,0,0,.1));' +
          'border-radius:20px;' +
          'padding:2px 10px 2px 8px;' +
          'box-shadow:0 1px 6px rgba(0,0,0,.1);' +
          'backdrop-filter:blur(6px);' +
          'cursor:default;user-select:none;font-family:inherit;' +
          'transition:opacity .2s;';
        // Click-to-hide (restores on next page navigation)
        _fbarEl.onclick = () => { _fbarEl.style.display = 'none'; };
        document.body.appendChild(_fbarEl);
      }
    }

    // Show only on Chat/Cowork (whitelist) — hide everywhere else (Code, etc.)
    const onAllowedPage = path === '/' || path.startsWith('/chat') ||
                          path.startsWith('/cowork') || path.startsWith('/new');
    _fbarEl.style.display = (anyKnown && onAllowedPage) ? 'inline-flex' : 'none';
    if (!anyKnown) return;

    _fbarEl.innerHTML =
      fbarBadge('C', _ctxPct,    '#3b82f6') +
      fbarBadge('H', _hourlyPct, '#f59e0b') +
      fbarTime(hoursUntil(_hourlyResetMs), 'h') +
      fbarBadge('W', _weeklyPct, '#22c55e') +
      fbarTime(daysUntil(_weeklyResetMs),  'd');
  }

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
    scanForRateLimit();
    setupPinBtns();
    applyPins();
    applyChatNumbers();
    scanForUsageExtras();
    updateFloatingBar();
    hideTopBar();
    hideUnavailableBanners();
    dismissStartupPopups();
    preferCodeTab();
    hideNewSessionOverview();
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
      // Floating bar is appended to body; re-check if body was remounted
      if (_fbarEl && !document.contains(_fbarEl)) _fbarEl = null;
    }
  }

  let _scanTimer = null;
  function debouncedScan() {
    if (_scanTimer) return;
    _scanTimer = setTimeout(() => { _scanTimer = null; scan(); }, 300);
  }

  function bootstrap() {
    if (!document.documentElement) { setTimeout(bootstrap, 100); return; }
    loadResetTimes(); // restore persisted hourly/weekly reset timestamps
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
