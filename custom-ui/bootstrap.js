// ─────────────────────────────────────────────────────────────
//  MAIN SCAN + BOOTSTRAP
//  2026-07-12: trimmed to the one live feature - the project selector
//  panel (workspace.js). Everything else (usage badges, pins, rings,
//  rate-limit, chat numbers, banners, floating bar, topbar shortcuts,
//  WCO patch) was dead code behind disabled calls and has been removed.
//  See memory/features.md for what used to be here.
//  2026-08-18: usage is back (usage.js), rebuilt on the app's own
//  /api/organizations/<org>/usage endpoint rather than on popover scraping.
// ─────────────────────────────────────────────────────────────
let lastPath = '';

function scan() {
  document.querySelectorAll('.flex.flex-wrap.gap-g5').forEach(row => {
    if (row.querySelector('button[aria-haspopup="menu"]')) installPanel(row);
  });
  // The panel lives on <body> now, so nothing tears it down when its row goes;
  // this also re-clamps it against a row that has moved (sidebar toggle).
  prunePanels();
  // 2s is the right cadence for a toast: fast enough that it barely registers,
  // slow enough not to be a hot loop.
  try { dismissLimitNags(); } catch (_) {}

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
  // Wrapped: the usage readout talks to the network and the two features share
  // one IIFE scope, so an exception here would otherwise take the project panel
  // down with it.
  try { installUsage(); } catch (e) { console.error('[cc-usage] install failed', e); }
  try { dgBootstrap(); } catch (e) { console.error('[cc-dump] install failed', e); }
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
