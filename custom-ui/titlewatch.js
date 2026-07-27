// ─────────────────────────────────────────────────────────────
//  TITLE WATCH
//  Claude Desktop reports a constant window caption of "Claude", so every
//  ActivityWatch event looks identical — "Claude → Claude" tells you nothing
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
//  When they all miss it leaves the title alone — a stale title is a much
//  smaller problem than a blank one.
//
//  Debug from DevTools: window.__ccTitleDebug()
// ─────────────────────────────────────────────────────────────

const TW_DEFAULT = 'Claude';
const TW_MAX_LEN = 90;

// Titles that carry no information — never worth overriding the default with.
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

// 2. The topbar row workspace.js already keys off — the chat/project name sits
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
