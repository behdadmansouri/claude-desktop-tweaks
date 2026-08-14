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
