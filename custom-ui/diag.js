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
