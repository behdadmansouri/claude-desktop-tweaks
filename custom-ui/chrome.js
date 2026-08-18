// ─────────────────────────────────────────────────────────────
//  WINDOW CHROME
//  Reclaims the in-app top bar. It holds back/forward (unused), a search
//  button (there's a shortcut) and the sidebar toggle (unused), so it is ~44px
//  of pure overhead.
//
//  The last attempt at this blanked the entire app (issues-fixed #18): it keyed
//  on `[data-top-left="true"]`, Claude later reused that attribute on a
//  container wrapping the whole page, and the hider took the page with it. So
//  this one does not match on any attribute or class at all.
//
//  Three layers of defence instead:
//    1. GEOMETRY. A candidate must be a full-width strip pinned to the very top
//       of the viewport, between 20 and 72px tall. A whole-app wrapper is
//       hundreds of pixels tall and fails immediately.
//    2. CONTENT. It must not contain the composer, <main>, or more than a token
//       amount of the page's text.
//    3. SELF-HEAL. Visible text is measured before and after hiding. If the
//       page lost most of its content, the hide is reverted on the spot and the
//       feature disables itself for the session. Getting it wrong now costs a
//       frame, not a working app.
//
//  Off switch, no rebuild needed:  localStorage['cc-hide-topbar'] = '0'
//
//  NOTE: this bar is also the window's drag region and carries the
//  minimise/maximise/close buttons (see issues-fixed #29). Hiding it means the
//  window has to be moved and closed some other way - the KDE titlebar, or
//  Ctrl+Q, which the preload already handles.
// ─────────────────────────────────────────────────────────────

const TOPBAR_KEY = 'cc-hide-topbar';
const TOPBAR_MIN_H = 20, TOPBAR_MAX_H = 72;

let _topbarHidden = null;   // the element we hid, so it can be put back
let _topbarGaveUp = false;

const hideTopbarWanted = () => {
  try { return localStorage.getItem(TOPBAR_KEY) !== '0'; } catch { return true; }
};

// innerText only counts what is actually visible, so a display:none subtree
// drops out of it. That gap is exactly what proved "rendered but hidden by us"
// during the #18 diagnosis, and it is what makes the self-heal check work.
const visibleTextLen = () => (document.body?.innerText || '').length;

function topbarCandidate() {
  const vw = window.innerWidth;
  // Only elements that actually start at the top of the viewport.
  const seen = new Set();
  for (const el of document.querySelectorAll('header, nav, div')) {
    if (seen.size > 400) break;
    const r = el.getBoundingClientRect();
    if (r.top > 6 || r.height < TOPBAR_MIN_H || r.height > TOPBAR_MAX_H) continue;
    if (r.width < vw * 0.6) continue;
    seen.add(el);
    // Never a container that holds the app itself.
    if (el.querySelector('main, textarea, [contenteditable="true"]')) continue;
    // A real top bar is a handful of icon buttons, not a page of prose.
    const txt = (el.innerText || '').trim();
    if (txt.length > 120) continue;
    if (!el.querySelector('button, [role="button"], a')) continue;
    return el;
  }
  return null;
}

function applyTopbar() {
  if (_topbarGaveUp) return;
  if (!hideTopbarWanted()) {
    if (_topbarHidden) { _topbarHidden.style.display = ''; _topbarHidden = null; }
    return;
  }
  // React remounts this bar; if our node is gone, look again.
  if (_topbarHidden && _topbarHidden.isConnected) return;
  const el = topbarCandidate();
  if (!el) return;

  const before = visibleTextLen();
  el.style.display = 'none';
  const after = visibleTextLen();

  // Losing nearly all visible text means we just hid the app, not a toolbar.
  if (before > 200 && after < before * 0.35) {
    el.style.display = '';
    _topbarGaveUp = true;
    console.error('[cc-chrome] top-bar hide reverted: visible text fell ' +
      before + ' -> ' + after + '. Disabled for this session.');
    return;
  }
  _topbarHidden = el;
  console.log('[cc-chrome] top bar hidden (' + Math.round(el.getBoundingClientRect().height) + 'px reclaimed)');
}

function installChrome() {
  window.__ccTopbar = {
    hide: () => { try { localStorage.setItem(TOPBAR_KEY, '1'); } catch (_) {} _topbarGaveUp = false; applyTopbar(); },
    show: () => { try { localStorage.setItem(TOPBAR_KEY, '0'); } catch (_) {} applyTopbar(); },
    candidate: topbarCandidate,
    hidden: () => _topbarHidden,
  };
  applyTopbar();
}
