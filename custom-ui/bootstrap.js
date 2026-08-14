// ─────────────────────────────────────────────────────────────
//  MAIN SCAN + BOOTSTRAP
//  2026-07-12: trimmed to the one live feature - the project selector
//  panel (workspace.js). Everything else (usage badges, pins, rings,
//  rate-limit, chat numbers, banners, floating bar, topbar shortcuts,
//  WCO patch) was dead code behind disabled calls and has been removed.
//  See memory/features.md for what used to be here.
// ─────────────────────────────────────────────────────────────
let lastPath = '';

function scan() {
  document.querySelectorAll('.flex.flex-wrap.gap-g5').forEach(row => {
    if (row.querySelector('button[aria-haspopup="menu"]')) installPanel(row);
  });

  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    document.querySelectorAll('[data-cc-row]').forEach(row => {
      delete row.dataset.ccRow;
      row.removeAttribute('data-cc-row');
    });
    removeAllPanels();
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
