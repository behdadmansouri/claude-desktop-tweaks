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

    // ── the empty band above the tab pills ──
    // Measured, not guessed (issues-fixed #18 is why): the app's own stylesheet
    // has exactly one rule that opens it -
    //     .dframe-root{--df-chrome-bar-height:0px}
    //     .dframe-root[data-wco]{--df-chrome-bar-height:36px}
    // and that variable is the sole consumer in two places:
    //     .dframe-content{padding-top:var(--df-chrome-bar-height)}
    //     .dframe-sidebar{top:calc(8px + var(--df-chrome-bar-height))}
    // i.e. the same 36px the user removed by hand in DevTools before asking for
    // this. `data-wco` means "the app is drawing its own window controls in an
    // overlay strip". Since 2026-08-25 the main window is titleBarStyle:"default"
    // and KWin draws the frame, so nothing is painted in that strip - it is
    // reserved space for controls that live in the titlebar now.
    //
    // Zeroing the variable is deliberately the whole fix: it moves the pills and
    // the sidebar up together, and it cannot blank the page the way hiding an
    // element can, because no element is hidden. `cc-chrome-bar=keep` in
    // localStorage puts the band back if a future build ever draws in it again.
    (() => { try { return localStorage.getItem('cc-chrome-bar') === 'keep'; } catch (_) { return false; } })()
      ? '/* chrome bar kept by cc-chrome-bar=keep */'
      : '.dframe-root[data-wco]{--df-chrome-bar-height:0px!important;}',

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
      '.cc-ws-panel select{color:inherit!important;}' +
      // The file picker's dropdown is painted by the platform, not by the page,
      // so it does not inherit the panel's colours - color:inherit on the
      // <select> alone leaves the open list as dark-on-dark. The options need
      // their own pair.
      '.cc-ws-panel select option{color:#ece5d5;background:#2e2919;}' +
    '}',
    '.cc-ws-panel select option{color:#1a1a1a;background:#f5f0e6;}',

    // ── open-TODO badge colours ──
    // These used to be inline: `background:currentColor` with the digit painted
    // in `var(--bg-100)`. Both halves were wrong. currentColor is whatever the
    // panel inherited, and --bg-100 is an app variable set on .dframe-content-inner
    // - the panel lives on <body>, outside it, so the digit fell back to a fixed
    // #1a1a1a that happened to match the pill in one theme and vanish in the
    // other. Reported 2026-08-26 as "the number is the same colour as the dot".
    //
    // The fix is to stop borrowing colours at all. The panel's own background is
    // hardcoded above (#f2e8d5 / #2e2919), so a badge can be given a fixed pair
    // that is legible against it in both themes, and the digit never depends on
    // what the surrounding page happens to have set.
    '.cc-todo-dot{background:#b4441e;color:#fff6ea;box-shadow:0 0 0 1.5px #f2e8d5;}',
    '.cc-todo-pill{color:#7d3312;background:rgba(180,68,30,.14);}',
    '.cc-todo-pill.cc-l1{background:rgba(180,68,30,.24);}',
    '.cc-todo-pill.cc-l2{background:rgba(180,68,30,.38);}',
    '@media (prefers-color-scheme:dark){' +
      '.cc-todo-dot{background:#f0a862;color:#2b2415;box-shadow:0 0 0 1.5px #2e2919;}' +
      '.cc-todo-pill{color:#f0c894;background:rgba(240,168,98,.16);}' +
      '.cc-todo-pill.cc-l1{background:rgba(240,168,98,.26);}' +
      '.cc-todo-pill.cc-l2{background:rgba(240,168,98,.40);}' +
    '}',
  ].join('\n');
  document.head.appendChild(s);
}
