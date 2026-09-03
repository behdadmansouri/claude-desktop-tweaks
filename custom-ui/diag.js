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

// What is holding the empty band ABOVE the tab pills open. With the native KWin
// frame in place that band is dead space, but nothing in it is a control, so
// dgTopBar() (which walks buttons) never sees the element that reserves it.
//
// Two views, because the answer is one of two shapes. `chain` walks up from a
// pill and reports every ancestor's own box: if the space is padding or a fixed
// height on a wrapper, it shows up there as paddingTop/height. `atPoint` asks
// what is actually painted at three points inside the band: if the space is a
// separate spacer element rather than padding, that is what finds it.
function dgTopChain() {
  const pill = [...document.querySelectorAll('button')].find(b => {
    const r = b.getBoundingClientRect();
    return r.height > 0 && r.top < 90 && r.width < 260 &&
           /^(code|chat and cowork|chat)$/i.test((b.textContent || '').trim());
  });
  const chain = [];
  if (pill) {
    for (let el = pill; el && el !== document.documentElement && chain.length < DIAG_MAX; el = el.parentElement) {
      const cs = getComputedStyle(el);
      chain.push({
        ...dgDesc(el),
        padTop: cs.paddingTop, marTop: cs.marginTop, height: cs.height,
        minHeight: cs.minHeight, pos: cs.position,
        appRegion: cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region') || undefined,
      });
    }
  }
  const atPoint = [];
  const vw = window.innerWidth;
  for (const [x, y] of [[vw / 2, 8], [vw / 2, 24], [vw / 2, 40]]) {
    const el = document.elementFromPoint(Math.round(x), y);
    atPoint.push(el ? {y, ...dgDesc(el)} : {y, none: true});
  }
  return {anchor: pill ? dgDesc(pill) : null, chain, atPoint};
}

// What the sidebar rows actually say, and where their leading glyph (if any)
// comes from. Asked 2026-08-26: several projects lost the emoji off their name
// in the left sidebar ("connoisseurd", "dogether", "claude-desktop-tweaks"),
// and those names are not the folder basenames on disk ("Connoisseurd 🎨",
// "Dogether 🐕", "Claude Desktop 🤖") - so the label is coming from somewhere
// other than the path, and guessing which somewhere is how this project has
// broken things before.
//
// Reports, per row: the visible text, the leading slot's own text/child tags
// and computed width (our own CSS forces that slot to width:auto, so if the
// glyph is there but invisible, the width is the tell), plus every data-*
// attribute and title/href on the row - that is where a path or an id that
// maps back to a folder would be.
function dgSidebarRows() {
  // Document-wide, not `.dframe-sidebar [data-row]`: scoping it to the sidebar
  // caught 22 chat titles and none of the project rows this was written for.
  const rows = document.querySelectorAll('[data-row]');
  const out = [];
  for (const row of rows) {
    const slot = row.querySelector('.df-leading-slot');
    const data = {};
    for (const a of row.attributes) {
      if (a.name.startsWith('data-') || a.name === 'title' || a.name === 'href') {
        data[a.name] = (a.value || '').slice(0, 80);
      }
    }
    out.push({
      text: (row.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      label: (row.getAttribute('aria-label') || '').slice(0, 60) || undefined,
      slot: slot
        ? {
            text: (slot.textContent || '').slice(0, 12),
            kids: [...slot.children].map(c => c.tagName.toLowerCase()).slice(0, 4),
            // Every slot on this build reports text:"" with one <span> child, so
            // the markup itself is the only thing that says what is in there.
            html: (slot.innerHTML || '').replace(/\s+/g, ' ').slice(0, 120),
            w: getComputedStyle(slot).width,
            disp: getComputedStyle(slot).display,
          }
        : null,
      attrs: data,
    });
    if (out.length >= 24) break;
  }
  return out;
}

// The first `sidebarRows` dump (2026-08-26) answered a question nobody asked:
// all 22 rows it caught were chat titles, because `.dframe-sidebar` in the Code
// tab holds sessions, not projects. The project rows the user means live in
// some other container, and the honest way to find a container you cannot name
// is to search by the text you already know is in it.
//
// So: hunt the needle anywhere in the document, then report the SMALLEST element
// containing it, plus a bounded slice of its row-ish ancestor's outerHTML. That
// last part is the point - it shows whether the missing glyph is an empty span,
// a background-image, an <img>, or genuinely absent from the markup, without
// another round trip. Needles are overridable: localStorage['cc-diag-find'] as
// a comma-separated list.
const FIND_KEY = 'cc-diag-find';
const FIND_DEFAULT = 'connoisseurd,dogether,claude-desktop';

function dgFindLabels() {
  let needles = FIND_DEFAULT;
  try { needles = localStorage.getItem(FIND_KEY) || FIND_DEFAULT; } catch (_) {}
  const list = needles.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return [];

  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('span,a,button,div,li,p')) {
    if (el.children.length > 1) continue;          // want the leaf that holds the text
    const t = (el.textContent || '').trim();
    if (!t || t.length > 80) continue;
    const low = t.toLowerCase();
    if (!list.some(n => low.includes(n))) continue;

    // The row is whatever ancestor carries data-row, or three levels up if the
    // build has stopped marking them.
    let row = el.closest('[data-row]');
    if (!row) { row = el; for (let i = 0; i < 3 && row.parentElement; i++) row = row.parentElement; }
    const key = t + '|' + dgRect(row).join(',');
    if (seen.has(key)) continue;
    seen.add(key);

    const slot = row.querySelector('.df-leading-slot');
    const attrs = {};
    for (const a of row.attributes) {
      if (a.name.startsWith('data-') || a.name === 'title' || a.name === 'href' || a.name === 'aria-label') {
        attrs[a.name] = (a.value || '').slice(0, 100);
      }
    }
    out.push({
      text: t,
      leaf: dgDesc(el),
      row: dgDesc(row),
      attrs,
      slot: slot ? {text: (slot.textContent || '').slice(0, 12), w: getComputedStyle(slot).width} : null,
      // Bounded on purpose: enough to see the shape of the row, not enough to
      // dump the sidebar into the log.
      html: (row.outerHTML || '').replace(/\s+/g, ' ').slice(0, 700),
    });
    if (out.length >= 6) break;
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
    topChain: dgTopChain(),
    sidebarRows: dgSidebarRows(),
    findLabels: dgFindLabels(),
    widthChain: dgWidthChain(),
    wsRow: dgWsRow(),
    nags: dgNags(),
    bridge: Object.keys(window.ccBridge || {}),
  };
  // One line, so it is greppable in a log full of React noise.
  console.error('[cc-dump] ' + JSON.stringify(out));
  return out;
}

// The workspace row: where the project panel hangs off, and the one anchor that
// is still matched by a Tailwind class (`.flex.flex-wrap.gap-g5`). Class names
// are design tokens and get renamed between builds, which is exactly what left
// the panel missing on the official build while everything else worked. This
// reports the ancestry of every menu button so a replacement anchor can be
// measured rather than guessed.
function dgWsRow() {
  const out = [];
  const btns = [...document.querySelectorAll('button[aria-haspopup="menu"]')].slice(0, 8);
  for (const btn of btns) {
    const r = btn.getBoundingClientRect();
    const chain = [];
    let el = btn.parentElement;
    for (let i = 0; i < 6 && el && el !== document.body; i++, el = el.parentElement) {
      const cs = getComputedStyle(el);
      const er = el.getBoundingClientRect();
      chain.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.baseVal !== undefined
                ? el.className.baseVal : String(el.className || '')).slice(0, 160),
        rect: [Math.round(er.x), Math.round(er.y), Math.round(er.width), Math.round(er.height)],
        menuBtns: el.querySelectorAll('button[aria-haspopup="menu"]').length,
        display: cs.display, wrap: cs.flexWrap, gap: cs.gap,
        attrs: [...el.attributes].map(a => a.name).filter(n => n.startsWith('data-')).slice(0, 6),
      });
    }
    out.push({
      label: (btn.getAttribute('aria-label') || btn.textContent || '').trim().slice(0, 60),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      chain,
    });
  }
  return {
    path: location.pathname,
    legacyAnchors: document.querySelectorAll('.flex.flex-wrap.gap-g5').length,
    menuButtons: btns.length,
    rows: out,
  };
}

function dgBootstrap() {
  window.__ccDump = ccDump;
  let off = false;
  try { off = localStorage.getItem(DIAG_KEY) === '0'; } catch (_) {}
  if (off) return;
  // Late enough that the composer footer and sidebar have rendered.
  setTimeout(() => { try { ccDump(); } catch (e) { console.error('[cc-dump] failed', e); } }, 6000);
}
