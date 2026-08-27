/**
 * Claude Desktop custom UI - v19
 * Generated from custom-ui/ modules by update-ui.sh - do not edit directly.
 */
(function () {
'use strict';

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

// ─────────────────────────────────────────────────────────────
//  QUICK WORKSPACE PANEL
//  Two-column floating panel (Local | Myserver) on new-session pages.
//  Hover-triggered; Local column live via cc-ai-data IPC or baked CC_AI_LOCAL.
// ─────────────────────────────────────────────────────────────
const WS_KEY    = 'cc-ws-v4';
const PANEL_CLS = 'cc-ws-panel';

// Tracks dialogs already handled, so the SSH remote-folder-browse dialog
// below doesn't re-trigger on the same dialog element.
const _seenDialogs = new WeakSet();

// "Time Management ⏱️" or "⏱️ Time Management" → {emoji:"⏱️", text:"Time Management"}
// Emoji and text are kept separate so the panel can render the emoji in its
// own span - it gets scaled up (see EMOJI_CSS) to be easier to pick out at a
// glance, and emoji-only mode drops the text entirely.
//
// This used to only look for a LEADING emoji, which is backwards: the workspace
// naming convention puts it at the END ("Claude Desktop 🤖", "Product Hunt 🛒"),
// so every folder came back emoji-less and "emoji only" mode silently did
// nothing at all. Both ends are checked now, suffix first since that is what
// this workspace actually uses.
//
// The candidate run has to contain a real pictograph. Matching "any non-letter"
// would read the trailing "." of a folder called "v1." - or the leading "." of
// a dotfile - as an emoji and eat it.
const PICTO_RE = /\p{Extended_Pictographic}/u;
function splitEmoji(name) {
  const post = name.match(/^(.*?[\p{L}\p{N}])[\s]*([^\p{L}\p{N}\s]+)$/su);
  if (post && PICTO_RE.test(post[2])) return {emoji: post[2].trim(), text: post[1].trimEnd()};
  const pre = name.match(/^([^\p{L}\p{N}]+)([\p{L}\p{N}].*)$/su);
  if (pre && PICTO_RE.test(pre[1])) return {emoji: pre[1].trim(), text: pre[2].trimEnd()};
  return {emoji: '', text: name};
}

// "⏱️ Time Management" → "Time Management ⏱️" (TODO-preview header)
function emojiSuffix(name) {
  const {emoji, text} = splitEmoji(name);
  return emoji ? text + ' ' + emoji : text;
}

// Oversized emoji that does NOT grow the line box: `line-height:0` makes an
// inline element contribute nothing to the line height, so rows stay the same
// height as text-only rows no matter how large font-size gets.
//
// That trick is right for a NAMED row, where the text sets the row height, and
// catastrophically wrong for an emoji-only tile, where the emoji is the only
// child: the button's content box collapsed to zero, leaving a 6px-tall hit
// target under a 21px glyph. The glyphs painted over each other and nothing was
// clickable. Emoji-only tiles use TILE_CSS instead, which gives them a real box.
const EMOJI_CSS = 'font-size:1.5em;line-height:0;display:inline-block;' +
  'vertical-align:-0.08em;flex:none;';
const TILE_PX = 30;
const TILE_CSS = 'font-size:19px;line-height:1;display:flex;align-items:center;' +
  'justify-content:center;width:100%;height:100%;flex:none;';

// How much of a project's name to show. Three modes rather than the old
// emoji-only boolean:
//
//   emoji - just the glyph, as a dense grid of square tiles
//   short - glyph + the first few characters, two columns
//   full  - glyph + the whole name, one column, wrapping rather than clipping
//
// `short` is the default because the truncated names were never actually the
// problem - a couple of characters plus the emoji is enough to recognise a
// project - but truncation you cannot escape IS a problem, which is what `full`
// is for.
const NAME_MODE_KEY  = 'cc-ws-name-mode';
const NAME_MODES     = ['emoji', 'short', 'full'];
const EMOJI_ONLY_KEY = 'cc-ws-emoji-only';   // superseded; read once to migrate
const SHORT_CHARS    = 12;

function nameMode() {
  try {
    const v = localStorage.getItem(NAME_MODE_KEY);
    if (NAME_MODES.includes(v)) return v;
    // Carry the old boolean over instead of silently resetting someone who had
    // emoji-only turned on.
    if (localStorage.getItem(EMOJI_ONLY_KEY) === '1') return 'emoji';
  } catch {}
  return 'short';
}
const setNameMode = v => { try { localStorage.setItem(NAME_MODE_KEY, v); } catch {} };

// "Claude Desktop" → "Claude Desk…". Cuts on a word boundary when one is close
// enough to the limit, so the label ends at a word rather than mid-syllable.
function shortText(text) {
  if (text.length <= SHORT_CHARS) return text;
  const cut = text.slice(0, SHORT_CHARS);
  const sp = cut.lastIndexOf(' ');
  return (sp >= SHORT_CHARS - 4 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

const CC_TODOS = (typeof CC_AI_TODOS !== 'undefined') ? CC_AI_TODOS : {};
function ccTodo(folder) {
  const live = (typeof window.__CC_TODOS__ === 'object' && window.__CC_TODOS__) || null;
  if (live && live[folder] != null) return live[folder];
  return CC_TODOS[folder];
}

// Sanitizing on WRITE (added in #21) never helped the entries already sitting
// in localStorage from before that fix, which is why the bottom of the SSH
// column kept showing unreadable tofu tiles. Clean on READ as well, and drop
// anything that has no readable characters left afterwards - a tile whose label
// is three zero-width spaces is unclickable and un-right-clickable, so it can
// never be removed through the UI either.
// ── how much attention a project is asking for ──────────────────────────────
//
// Counted off the same TODO.md text the preview pane already has (baked at
// build time, refreshed live over cc-ai-data), so this costs one regex pass per
// tile and needs no new IPC.
//
// Only OPEN boxes are counted. A file that is entirely ticked off reads as zero
// - which is the useful signal: a project with nothing left to do should look
// as quiet as a project with no TODO.md at all.
//
// Deliberately literal about the syntax: a line whose first non-space content
// is a list bullet followed by [ ]. Anything looser starts counting checkboxes
// quoted inside code fences and prose, and an inflated number is worse than no
// number, because you'd stop trusting it.
const OPEN_BOX_RE  = /^[ \t]*[-*+][ \t]+\[[ \t]\]/gm;
const DONE_BOX_RE  = /^[ \t]*[-*+][ \t]+\[[xX]\]/gm;
const _countRe = (text, re) => { re.lastIndex = 0; return (text.match(re) || []).length; };

function todoCounts(folder) {
  const text = ccTodo(folder);
  if (typeof text !== 'string' || !text) return null;
  const open = _countRe(text, OPEN_BOX_RE);
  const done = _countRe(text, DONE_BOX_RE);
  if (!open && !done) return null;   // a TODO.md with no checkboxes at all
  return {open, done};
}

const hasReadable = s => /[\p{L}\p{N}]/u.test(s || '');
function loadWS() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(WS_KEY) || '[]'); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out = [];
  let dropped = false;
  for (const w of raw) {
    if (!w || typeof w !== 'object') { dropped = true; continue; }
    const conn = cleanLabel(w.conn), folder = cleanLabel(w.folder);
    if (!hasReadable(conn) || !hasReadable(folder)) { dropped = true; continue; }
    out.push({conn, folder, ts: w.ts || 0});
  }
  // Rewrite once so the garbage doesn't have to be re-filtered on every render.
  if (dropped) { try { localStorage.setItem(WS_KEY, JSON.stringify(out)); } catch {} }
  return out;
}
const saveWS = list => localStorage.setItem(WS_KEY, JSON.stringify(list.slice(0, 40)));

// Labels are scraped from button textContent, which can pick up characters
// that aren't part of the folder name at all - control/format codepoints, and
// private-use codepoints from icon fonts (the likely source of the unreadable
// tiles that showed up in the remote column). Strip them so the entry is
// readable and so two spellings of the same folder don't both persist.
function cleanLabel(s) {
  return (s || '').replace(/[\p{Cc}\p{Cf}\p{Co}]/gu, '').replace(/\s+/g, ' ').trim();
}

// Every string a menu row might be carrying its name in.
//
// Until 2026-08-21 the connection menu's rows read like "Local, environment
// settings, right arrow" straight off textContent. Since the 08-22 build they
// read "" - every [cc-ws-debug] line since logs `items:["","Cloud","Remote
// Control","SSH"]` and `from:""`. The name moved out of the text node; matching
// on textContent alone has been blind ever since, which is both why Local was
// never recognised (so the connection menu was driven on every single click -
// the slowness) and why no host could be selected.
//
// Rather than bet on where it moved to, collect every candidate and let the
// scorer take the best. A row that still puts its name in textContent keeps
// working; one that moved it to aria-label, a title, an aria-labelledby target
// or a nested icon's alt now works too.
function labelsOf(el) {
  const out = [];
  if (!el || !el.getAttribute) return out;
  const push = v => { const c = cleanLabel(v); if (c && !out.includes(c)) out.push(c); };
  push(el.getAttribute('aria-label'));
  push(el.getAttribute('data-value'));
  push(el.getAttribute('value'));
  push(el.getAttribute('title'));
  push(el.getAttribute('data-path'));
  push(el.textContent);
  // aria-labelledby points at elements elsewhere in the document, so it has to
  // be dereferenced rather than read.
  const by = el.getAttribute('aria-labelledby');
  if (by) for (const id of by.split(/\s+/)) {
    const t = id && document.getElementById(id);
    if (t) push(t.textContent);
  }
  if (el.querySelectorAll) {
    for (const k of el.querySelectorAll('[aria-label],[title],img[alt],[data-value]')) {
      push(k.getAttribute('aria-label'));
      push(k.getAttribute('title'));
      push(k.getAttribute('alt'));
      push(k.getAttribute('data-value'));
    }
  }
  return out;
}

// The one label to show a human. First non-empty candidate, so aria-label wins
// over a text node that may just be decoration.
const bestLabel = el => labelsOf(el)[0] || '';

// What a row is, for the debug beacon - so if the name has moved somewhere none
// of the above looks, the next log line says exactly where to look instead of
// leaving it to another round of guessing.
function rowShape(el) {
  if (!el || !el.attributes) return null;
  const at = {};
  for (const a of el.attributes) {
    if (/^(class|style)$/.test(a.name)) continue;
    at[a.name] = (a.value || '').slice(0, 60);
  }
  return {tag: el.tagName, at, txt: (el.textContent || '').trim().slice(0, 40),
          html: (el.innerHTML || '').slice(0, 200)};
}

// ── the app's OWN record of where you've been ───────────────────────────────
//
// cc-ws-v4 only ever knew what our own code happened to observe, and between
// July and 2026-08-21 it observed nothing at all (see sampleWS). The app has
// been keeping the same information the whole time, in the renderer's own
// localStorage under `desktop-recent-workspaces` - same origin, no IPC needed.
// Reading it is how the Remote column gets populated with servers that were
// never used while our panel happened to be watching.
//
// The shape isn't documented, so every field name it might plausibly use is
// tried and anything unrecognised is skipped. The first parse logs a sample
// under [cc-ws-recent] so the guesses can be narrowed against reality.
const APP_RECENT_KEY = 'desktop-recent-workspaces';
// Enough to tell "/home/z3z0/Documents/..." from "/root/000_myagents/...".
// Derived from the baked local folder list rather than assumed, so it is right
// on any machine this is deployed to.
const HOME_HINT = (typeof CC_AI_LOCAL !== 'undefined' && CC_AI_LOCAL[0])
  ? CC_AI_LOCAL[0].split('/').slice(0, 3).join('/') + '/'
  : '/home/';
let _loggedRecent = false;

const _pick = (o, names) => {
  for (const n of names) {
    let v = o[n];
    if (v && typeof v === 'object') v = v.name || v.displayName || v.id;
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
};

function appRecentWorkspaces() {
  let data;
  try { data = JSON.parse(localStorage.getItem(APP_RECENT_KEY) || 'null'); } catch { return []; }
  if (!data) return [];
  const list = Array.isArray(data) ? data
    : Array.isArray(data.workspaces) ? data.workspaces
    : Array.isArray(data.recent) ? data.recent : [];
  if (list.length && !_loggedRecent) {
    _loggedRecent = true;
    console.log('[cc-ws-recent]', JSON.stringify(list.slice(0, 3)));
  }
  const out = [];
  for (const w of list) {
    if (!w || typeof w !== 'object') continue;
    const folder = cleanLabel(_pick(w, ['path', 'folder', 'directory', 'cwd', 'workingDirectory', 'workspacePath']));
    if (!folder) continue;
    const conn = cleanLabel(_pick(w, ['connectionName', 'connection', 'environmentName', 'environment', 'host', 'sshHost', 'hostName'])) || 'Local';
    out.push({conn, folder});
  }
  return out;
}

// Every SSH connection configured in the app, whether or not a folder has ever
// been recorded for it - so an unused server still shows up as a heading you can
// see rather than being invisible. Read once; the file changes rarely.
let _sshHosts = null;
function loadSshHosts() {
  if (_sshHosts || !window.ccBridge || !window.ccBridge.sshConfigs) return;
  _sshHosts = [];
  window.ccBridge.sshConfigs().then(r => {
    if (r && r.ok && Array.isArray(r.hosts)) {
      _sshHosts = r.hosts.map(h => cleanLabel(h.name)).filter(Boolean);
      rebuildPanel();
    }
  }).catch(() => {});
}

function recordWS(conn, folder) {
  conn = cleanLabel(conn);
  folder = cleanLabel(folder);
  if (!conn || !folder) return;
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const list = loadWS().filter(w =>
    !(same(cleanLabel(w.conn), conn) && same(cleanLabel(w.folder), folder)));
  list.unshift({conn, folder, ts: Date.now()});
  saveWS(list);
  rebuildPanel();
}

// Drop one recorded entry (right-click on a remote tile).
function forgetWS(conn, folder) {
  saveWS(loadWS().filter(w => !(w.conn === conn && w.folder === folder)));
  rebuildPanel();
}

// Which connection the app is on RIGHT NOW.
//
// The button's own label is the direct answer and is tried first, but on the
// current build it reads "" (see labelsOf), and an unknown current connection
// is what forced the connection menu open on every click. So fall back to two
// records of app state that are readable regardless of how the button is
// labelled:
//
//   2. the app's own `desktop-recent-workspaces` - its newest entry IS the
//      current workspace, and it carries the connection name.
//   3. whatever we ourselves last successfully switched to.
//
// Order matters: the live button beats a stored record, and the app's record
// beats ours, since the user can switch connections without going through us.
const LAST_CONN_KEY = 'cc-ws-lastconn';
function currentConnection(connBtn) {
  const direct = connBtn ? bestLabel(connBtn) : '';
  if (direct) return {name: direct, via: 'button'};
  const recent = appRecentWorkspaces();
  if (recent.length && recent[0].conn) return {name: recent[0].conn, via: 'app-recent'};
  try {
    const v = localStorage.getItem(LAST_CONN_KEY);
    if (v) return {name: v, via: 'ours'};
  } catch (_) {}
  return {name: '', via: 'unknown'};
}
const rememberConn = name => {
  try { localStorage.setItem(LAST_CONN_KEY, cleanLabel(name)); } catch (_) {}
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Whitespace-collapsed text of an element, for comparing two DOM nodes that may
// be the same menu row wrapped twice.
const flatText = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();

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
// Existing connections (Local/Myserver) render as a Radix radio-group of
// environments - role="menuitemradio", not "radio". Confirmed via cc-ws-debug
// logs (2026-07-10): the conn menu's static "Add cloud environment…" etc.
// actions were captured fine, but "Local"/"Myserver" never showed up even
// after a settle-time wait - they were invisible to this selector, not late.
const _ITEM_SEL = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],' +
  '[role="option"],[role="radio"],[role="checkbox"],' +
  '[data-cmdk-item],[cmdk-item],[data-radix-collection-item],li,button';

// Finds the newly-opened menu, then waits for its item count to STABILIZE
// before returning - not just for the first non-empty snapshot. Confirmed
// via cc-ws-debug logs (2026-07-10): the connection menu renders its static
// "Add cloud environment… / Set up Remote Control… / Add SSH host…" actions
// immediately, then appends existing connections (e.g. "Myserver") a beat
// later once they load. The old code grabbed the first 3-item snapshot and
// never saw "Myserver" at all - not a click failure, a race.
async function waitNewMenu(ms = 2500) {
  const existing = new Set(document.querySelectorAll(_MENU_SEL));
  await sleep(80);
  const deadline = Date.now() + ms;
  let candidate = null;
  while (Date.now() < deadline && !candidate) {
    for (const m of document.querySelectorAll(_MENU_SEL)) {
      if (!existing.has(m)) { candidate = m; break; }
    }
    if (!candidate) await sleep(60);
  }
  if (!candidate) return [];

  // Innermost matches only. _ITEM_SEL lists both `li` and `button`, so a menu
  // built as `<li><button>Pebble</button></li>` produced TWO entries for one
  // visible row - and the old filter (drop anything containing a [role=menuitem])
  // did not catch it, because a plain button carries no role. A menu of N rows
  // could therefore come back as a list of 2N, and the keyboard fallback
  // navigates by INDEX: `indexOf(target)` counted phantom rows, pressed
  // ArrowDown that many times, and committed whatever was highlighted when it
  // stopped. That is the "I picked Pebble and it opened Time Management" bug -
  // not a matching failure, an off-by-N walk. keyboardPick() below now verifies
  // the highlight before pressing Enter, so this is belt and braces.
  //
  // Only ever drops an ancestor whose text is IDENTICAL to a descendant's - that
  // is the duplication (`<li><button>Pebble</button></li>`), and it is the only
  // case where dropping is safe. A blanket "keep innermost" was tried on
  // 2026-08-21 and immediately broke the connection menu: its "Local" row
  // contains a nested control, so the labelled row was discarded in favour of an
  // unlabelled child and the menu scraped as ["", "Cloud", "Remote Control",
  // "SSH"]. Local vanished, no match was found, and clickWorkspace bailed before
  // it ever reached the folder step - which is how a fix for picking the wrong
  // project turned into not being able to pick any project.
  const flat = s => (s || '').replace(/\s+/g, ' ').trim();
  const grab = () => {
    const raw = [...candidate.querySelectorAll(_ITEM_SEL)].filter(i => flat(i.textContent));
    return raw.filter(el => !raw.some(o =>
      o !== el && el.contains(o) && flat(o.textContent) === flat(el.textContent)));
  };

  let items = grab();
  let lastCount = items.length;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(100);
    if (!candidate.isConnected) break; // menu closed under us
    items = grab();
    if (items.length !== lastCount) {
      lastCount = items.length;
      stableSince = Date.now();
    } else if (items.length > 0 && Date.now() - stableSince > 250) {
      break; // count held steady for 250ms with at least one item - settled
    }
  }
  return items;
}

// 3 = exact, 2 = one is a prefix of the other, 1 = loose substring, 0 = no.
//
// The old version returned a bare boolean with `it.includes(f) || f.includes(it)`
// and callers took the FIRST menu item that passed. "AI Projects" is a substring
// of "AI Projects Manager", "Behi Blueprint" of nothing but "Fashion" of
// "Fashion Archive", and so on - so picking a project could quietly open a
// different one whose name merely contained it. Scoring plus best-of lets an
// exact match beat an accidental substring no matter what order the menu is in.
function matchScore(itemText, folder) {
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = folder.split('/').filter(Boolean).pop() || folder;
  const it = norm(itemText), f = norm(name);
  if (!it || !f) return 0;
  if (it === f) return 3;
  if (it.startsWith(f) || f.startsWith(it)) return 2;
  if (it.includes(f) || f.includes(it)) return 1;
  return 0;
}

function matchFolder(itemText, folder) {
  return matchScore(itemText, folder) > 0;
}

// Score a whole element rather than one string off it: the caller's own
// accessor first (it knows which attribute this particular menu prefers), then
// every other place the name might live. Best of all of them wins, so adding
// candidates can only ever turn a miss into a hit - never a hit into a
// different hit, because the scores are compared, not concatenated.
function scoreEl(el, folder, textOf) {
  let best = 0;
  if (textOf) best = matchScore(textOf(el), folder);
  if (best >= 3) return best;
  for (const c of labelsOf(el)) {
    const s = matchScore(c, folder);
    if (s > best) best = s;
    if (best >= 3) break;
  }
  return best;
}

// Best candidate, or null. A merely-substring match (score 1) is only accepted
// when it is the single candidate in the whole menu - otherwise it is exactly
// the ambiguity that used to open the wrong project.
function bestMatch(items, folder, textOf) {
  let best = null, bestScore = 0, bestCount = 0;
  for (const el of items) {
    const s = scoreEl(el, folder, textOf);
    if (s === 0) continue;
    if (s > bestScore) { best = el; bestScore = s; bestCount = 1; }
    else if (s === bestScore) bestCount++;
  }
  if (!best) return null;
  if (bestScore === 1 && bestCount > 1) return null;
  if (bestScore >= 2 && bestCount > 1) console.warn('[cc-ws] ambiguous folder match for', folder);
  return best;
}

// Whatever the open menu currently considers selected. Radix marks it with
// data-highlighted; a plain listbox uses aria-selected; some builds only move
// DOM focus.
function menuHighlighted() {
  const menu = document.querySelector(_MENU_SEL);
  if (!menu) return null;
  const marked = menu.querySelector('[data-highlighted],[aria-selected="true"]');
  if (marked) return marked;
  const a = document.activeElement;
  return (a && a !== document.body && menu.contains(a)) ? a : null;
}

// Identity first, text only as a fallback - and only when there IS text.
// The old last clause compared two trimmed textContents for equality, which on
// the current build compares "" to "" and returns true for EVERY row: the
// keyboard walk would then press Enter on whatever happened to be highlighted,
// believing it had arrived. Same class of failure as the matcher above, and the
// more dangerous half of it, because it commits.
const sameItem = (hot, target) => {
  if (!hot) return false;
  if (hot === target || hot.contains(target) || target.contains(hot)) return true;
  const a = bestLabel(hot), b = bestLabel(target);
  return !!a && !!b && a === b;
};

// Walk a Radix menu with the arrow keys - which is the one input path that
// doesn't check event.isTrusted - and press Enter ONLY once the thing actually
// highlighted is the thing we want.
//
// The previous version computed an index, pressed ArrowDown that many times, and
// committed blind. Every way that can drift (a duplicated scrape entry, a
// disabled row the menu skips, a row that arrives late, Home not being handled)
// ends the same way: the wrong project opens, silently, with no clue that
// anything went wrong. Checking the highlight each step costs a few frames and
// turns every one of those into "nothing happened", which is recoverable.
async function keyboardPick(items, target) {
  if (items.indexOf(target) < 0) return false;
  const start = (document.activeElement && document.activeElement !== document.body)
    ? document.activeElement : target;
  const kd = key =>
    start.dispatchEvent(new KeyboardEvent('keydown', {key, code: key, bubbles: true, cancelable: true}));

  kd('Home');
  await sleep(70);
  // items.length + 2 steps is a full lap plus slack: menus wrap at the end, so
  // this reaches every row no matter where Home actually left the highlight.
  for (let i = 0; i <= items.length + 2; i++) {
    if (sameItem(menuHighlighted(), target)) {
      kd('Enter');
      start.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', code: 'Enter', bubbles: true}));
      await sleep(220);
      return true;
    }
    kd('ArrowDown');
    await sleep(50);
  }
  console.warn('[cc-ws] never highlighted the target row; not committing');
  return false;
}

// Call React's own event handlers via the fiber tree.
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

function findWsBtns(wsRow) {
  const menuBtns = [...wsRow.querySelectorAll('button[aria-haspopup="menu"]')];
  if (menuBtns.length >= 2) return [menuBtns[0], menuBtns[1]];
  const connBtn = menuBtns[0] || null;
  const allBtns = [...wsRow.querySelectorAll('button')];
  const folderBtn = allBtns.find(b => b !== connBtn) || null;
  return [connBtn, folderBtn];
}

// Notices what the workspace row is set to after the user has changed it by
// hand, and records it - which is how a connection/folder they picked
// themselves turns up in the panel next time.
//
// This is the ONLY writer of cc-ws-v4, and cc-ws-v4 is the entire source of the
// Remote column. It went missing in the 2026-07-12 trim while its call site in
// installPanel stayed, so every click on the workspace row has been throwing a
// ReferenceError out of a capture-phase listener since, and no remote folder has
// been recorded at all - the Remote column has just been showing whatever was in
// localStorage from before that. Worth knowing when reading the panel's remote
// entries as evidence of anything.
//
// Deferred: the click is captured on the way DOWN, so at that instant the row
// still shows the OLD selection. React needs a beat to repaint the labels.
function sampleWS(wsRow) {
  setTimeout(() => {
    try {
      if (!wsRow.isConnected) return;
      const [connBtn, folderBtn] = findWsBtns(wsRow);
      if (!connBtn || !folderBtn) return;
      const conn = cleanLabel(connBtn.textContent);
      const folder = cleanLabel(folderBtn.textContent);
      if (!conn || !folder) return;
      // The folder button reads as a call to action when nothing is chosen yet.
      if (/^(open|browse|select|choose|add|no) /i.test(folder)) return;
      recordWS(conn, folder);
    } catch (e) {
      console.error('[cc-ws] sampleWS', e);
    }
  }, 900);
}

async function clickWorkspace(conn, folder, wsRow) {
  console.log('[cc-ws] clickWorkspace', conn, folder);
  if (!wsRow?.isConnected) { console.log('[cc-ws] wsRow disconnected'); return; }
  const [connBtn, folderBtn] = findWsBtns(wsRow);
  console.log('[cc-ws] buttons found:', !!connBtn, !!folderBtn);
  if (!connBtn || !folderBtn) return;

  // Where we are now, from whichever of the three sources can actually answer
  // (see currentConnection). An unknown current connection is what forced the
  // connection menu open on EVERY click, including the overwhelmingly common
  // Local→Local case: all the fragility of that path was being paid for when
  // there was nothing to switch. That is the slowness.
  const here = currentConnection(connBtn);
  const currentConn = here.name;
  const normConn = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // The label reads like "Local, environment settings, right arrow", so this is
  // containment, not equality.
  const alreadyOn = !!currentConn && normConn(currentConn).includes(normConn(conn));
  console.log('[cc-ws] currentConn:', currentConn, '(via ' + here.via + ')',
              '→ want:', conn, 'alreadyOn:', alreadyOn);
  if (!alreadyOn) {
    fireClick(connBtn);
    let connItems = await waitNewMenu();
    console.log('[cc-ws] conn menu items:', connItems.map(bestLabel));

    // The connection menu is a menu of CATEGORIES - Local / Cloud / Remote
    // Control / SSH - and the actual hosts live in a submenu under SSH. The old
    // code only ever looked at the top level, so a host name was never among the
    // items and switching to one could not work no matter how the matching was
    // written. If the host isn't at the top level, open the category and look
    // again.
    const wantHost = normConn(conn) !== 'local';
    const listed = () => connItems.some(el =>
      labelsOf(el).some(l => normConn(l).includes(normConn(conn))));
    if (wantHost && !listed()) {
      const cat = connItems.find(el => /^ssh\b/i.test(bestLabel(el))) ||
        connItems.find(el => labelsOf(el).some(l => /ssh/i.test(l)));
      if (cat) {
        console.log('[cc-ws] opening SSH submenu for', conn);
        // Submenus open on hover as well as click; fireClick sends pointerover
        // first, which is what actually triggers a Radix submenu.
        fireClick(cat);
        const sub = await waitNewMenu(3000);
        if (sub.length) connItems = sub;
        console.log('[cc-ws] submenu items:', connItems.map(bestLabel));
      }
    }
    // Best match, not first match, and never one of the menu's own actions.
    // "Add SSH host…" contains no host name, but "Manage Myserver…" would, and
    // picking that opens a settings dialog instead of switching the connection -
    // which is one of the ways switching hosts appeared to just not work.
    const CONN_ACTION_RE = /^(add|set up|setup|manage|configure|connect to|new)\b/i;
    const connTarget = bestMatch(
      connItems.filter(el => !labelsOf(el).some(l => CONN_ACTION_RE.test(l))),
      conn, bestLabel);
    const dbgConn = {
      ts: Date.now(), stage: 'conn', conn, from: currentConn, via: here.via,
      found: !!connTarget,
      items: connItems.map(el => labelsOf(el).join(' | ').slice(0, 60)),
      // If the name has moved somewhere labelsOf still doesn't look, this says
      // where it actually is. Only the first two rows, to keep the line short.
      shapes: connItems.slice(0, 2).map(rowShape),
    };
    localStorage.setItem('cc-ws-debug', JSON.stringify(dbgConn));
    console.error('[cc-ws-debug]', JSON.stringify(dbgConn));
    // Not finding the connection is no longer fatal. Failing to switch is a
    // reason to skip the switch, not a reason to abandon picking the folder -
    // and since `alreadyOn` above can only be trusted when the label reads,
    // "couldn't find it" very often just means we were already there.
    if (!connTarget) {
      console.log('[cc-ws] conn target not found; continuing with the current connection');
      document.body.click();
      await sleep(200);
    } else {
      // "The menu closed and the button no longer says what it used to."
      // When the button has no readable label at all (the current build), the
      // second half can't be evaluated, so menu-closed is the only evidence
      // available - treat that as committed rather than retrying three ways
      // against a check that can never pass.
      const connCommitted = () => {
        if (document.querySelector(_MENU_SEL)) return false;
        const now = bestLabel(connBtn);
        if (!now || !currentConn) return true;
        return !normConn(now).includes(normConn(currentConn));
      };

      // Approach 1: React fiber handler - bypasses isTrusted
      tryFiberClick(connTarget);
      await sleep(220);

      // Approach 2: keyboard nav - Radix keydown doesn't check isTrusted
      if (!connCommitted()) await keyboardPick(connItems, connTarget);

      // Approach 3: synthetic pointer sequence (last resort)
      if (!connCommitted()) { fireClick(connTarget); await sleep(220); }

      console.error('[cc-ws-debug] conn committed=' + connCommitted());
      await sleep(400);
      // Switching to an SSH connection can put up a host-picker dialog. The old
      // code only ever handled the degenerate one-option case and gave up
      // otherwise - which, with more than one host configured, meant the dialog
      // opened and simply sat there. That is the "it opens the host selector and
      // can't select the other host" symptom. Pick by name, the same scored way
      // folders are picked, and only fall back to the single-option shortcut.
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(d => d.offsetParent && !_seenDialogs.has(d));
      if (dialog) {
        _seenDialogs.add(dialog);
        const raw = [...dialog.querySelectorAll('[role="option"],li,button')]
          .filter(el => el.textContent.trim() && el.offsetParent);
        const opts = raw.filter(el => !raw.some(o =>
          o !== el && el.contains(o) && flatText(o) === flatText(el)));
        const HOST_ACTION_RE = /^(cancel|close|back|add|new|manage|help)\b/i;
        const pickable = opts.filter(el => !labelsOf(el).some(l => HOST_ACTION_RE.test(l)));
        const hostTarget = bestMatch(pickable, conn, bestLabel) ||
          (pickable.length === 1 ? pickable[0] : null);
        console.error('[cc-ws-debug]', JSON.stringify({
          ts: Date.now(), stage: 'conn-dialog', conn, found: !!hostTarget,
          options: pickable.map(el => labelsOf(el).join(' | ').slice(0, 60)),
          shapes: pickable.slice(0, 2).map(rowShape),
        }));
        if (hostTarget) {
          if (!tryFiberClick(hostTarget)) fireClick(hostTarget);
          await sleep(400);
          // Some builds want an explicit confirm after selecting the host.
          const confirm = [...dialog.querySelectorAll('button')]
            .filter(b => b.offsetParent)
            .find(b => /^(connect|select|ok|continue|done)$/i.test((b.textContent || '').trim()));
          if (confirm) { if (!tryFiberClick(confirm)) fireClick(confirm); await sleep(400); }
        }
      }
    }
  }

  if (!wsRow.isConnected) { console.log('[cc-ws] wsRow disconnected after conn switch'); return; }
  const [, fb] = findWsBtns(wsRow);
  if (!fb) { console.log('[cc-ws] folder button gone after conn switch'); return; }

  const folderBtnLabelBefore = (fb.textContent || '').trim();

  console.log('[cc-ws] clicking folder button');
  fireClick(fb);
  // SSH folder listings are fetched over the network and can be slow to
  // populate the dropdown - give non-Local connections more time.
  const folderItems = await waitNewMenu(conn === 'Local' ? 2500 : 6000);
  const menuRoot = document.querySelector(_MENU_SEL);
  const dbgItems = folderItems.map(i => ({
    t: i.textContent.trim().slice(0, 40),
    v: i.getAttribute('data-value') || '',
    r: i.getAttribute('role') || '',
  }));
  const folderTarget = bestMatch(folderItems, folder,
    el => el.getAttribute('data-value') || el.getAttribute('value') || el.textContent);
  const dbg = {
    ts: Date.now(), folder, found: !!folderTarget,
    menuTag: menuRoot ? (menuRoot.getAttribute('role') || menuRoot.tagName) : null,
    count: folderItems.length, items: dbgItems,
  };
  localStorage.setItem('cc-ws-debug', JSON.stringify(dbg));
  console.error('[cc-ws-debug]', JSON.stringify(dbg));

  const committed = () => {
    if (document.querySelector(_MENU_SEL)) return false;
    const nameNow = (fb.textContent || '').trim();
    const want = folder.split('/').filter(Boolean).pop() || folder;
    return nameNow !== folderBtnLabelBefore && matchFolder(nameNow, want);
  };

  if (folderTarget) {
    folderTarget.scrollIntoView({block: 'nearest'});
    await sleep(30);

    // Approach 1: React fiber handler - bypasses isTrusted
    tryFiberClick(folderTarget);
    await sleep(160);
    if (committed()) { console.error('[cc-ws-debug] committed via fiber'); return; }

    // Approach 2: Keyboard navigation - Radix keydown doesn't check isTrusted
    if (folderItems.indexOf(folderTarget) >= 0) {
      const picked = await keyboardPick(folderItems, folderTarget);
      const stillOpen = document.querySelector(_MENU_SEL);
      if (stillOpen) {
        // Only ever click the target itself now. The old code clicked whatever
        // was highlighted when Enter failed, which is how a mistimed walk turned
        // into "it opened some other project".
        console.log('[cc-ws] Enter did not commit; clicking the target directly');
        if (!tryFiberClick(folderTarget)) fireClick(folderTarget);
        await sleep(140);
      }
      console.error('[cc-ws-debug] after keyboard nav, picked=' + picked + ' committed=' + committed());
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

  // The app's Local folder dropdown only offers "Open folder…" (a native OS
  // picker) - it never lists projects. ccBridge.armFolder primes the main
  // process so the very next browseFolder IPC returns this path directly (no
  // dialog); React then sets it as the workspace. Falls back to the picker.
  const openItem = folderItems.find(el => /open folder/i.test(el.textContent || ''));
  if (folderItems.length <= 1 && openItem) {
    const want = folder.split('/').filter(Boolean).pop() || folder;
    if (window.ccBridge && typeof window.ccBridge.armFolder === 'function') {
      try {
        await window.ccBridge.armFolder(folder);
        fireClick(openItem);
        for (let i = 0; i < 12; i++) {
          await sleep(150);
          const [, fb2] = findWsBtns(wsRow);
          if (fb2 && matchFolder((fb2.textContent || '').trim(), want)) { document.body.click(); return; }
        }
        return;
      } catch (_) {}
    }
    fireClick(openItem);
    return;
  }

  // SSH: the remote folder dropdown only offers "Browse remote folder…" -
  // never actual remote directory names (confirmed via cc-ws-debug logs,
  // 2026-07-10). Clicking it opens a Claude-native remote directory browser
  // (root/back/subfolder entries + Go/Cancel/Select Folder action buttons -
  // confirmed via cc-ws-debug). We ONLY click a folder entry when its name
  // is an EXACT match in the currently-shown listing, then look for a
  // "Select Folder" confirm button. We deliberately never blind-click "Go"
  // or press Enter here - an earlier version did, using just the folder's
  // basename (not a real path) as the query, and it mis-fired into an
  // unrelated app dialog. Better to do nothing than guess wrong.
  const browseItem = folderItems.find(el => /browse.*folder|remote folder/i.test(el.textContent || ''));
  if (folderItems.length <= 1 && browseItem) {
    fireClick(browseItem);
    await sleep(500);
    const dlg = [...document.querySelectorAll('[role="dialog"]')]
      .find(d => d.offsetParent && !_seenDialogs.has(d));
    const dbg = {ts: Date.now(), stage: 'ssh-folder-dialog', folder, dialogFound: !!dlg};
    if (dlg) {
      _seenDialogs.add(dlg);
      const ACTION_LABELS = /^(go|cancel|select folder|ok|open|choose|confirm|back|up)$/i;
      const all = [...dlg.querySelectorAll(_ITEM_SEL)]
        .filter(i => i.textContent.trim() && !i.querySelector('[role="menuitem"],[role="option"]'));
      const entries = all.filter(i => !ACTION_LABELS.test((i.textContent || '').trim()));
      dbg.listedFolders = entries.map(i => i.textContent.trim().slice(0, 40));
      dbg.actionButtons = all
        .filter(i => ACTION_LABELS.test((i.textContent || '').trim()))
        .map(i => i.textContent.trim());

      // Walk the path one segment at a time, clicking only entries that are an
      // EXACT match for the segment we are looking for and re-reading the
      // listing after each step. A remote path is almost never a single hop from
      // wherever the browser opens, which is why matching only the final
      // basename in the first listing found nothing and left the dialog sitting
      // open. Still no blind "Go" and no Enter: a segment that isn't listed
      // stops the walk, and the dialog is left open where the user can finish it
      // by hand.
      const listEntries = () => {
        const all = [...dlg.querySelectorAll(_ITEM_SEL)]
          .filter(i => i.textContent.trim() && i.offsetParent);
        const inner = all.filter(el => !all.some(o => o !== el && el.contains(o)));
        return inner.filter(i => !ACTION_LABELS.test((i.textContent || '').trim()));
      };
      const segs = folder.split('/').filter(Boolean);
      dbg.pathSegments = segs;
      dbg.walked = [];
      let cur = entries;
      let si = 0, landed = false;
      for (let hops = 0; hops < segs.length + 2 && si < segs.length; hops++) {
        // The browser may already have opened partway down the path, so look for
        // the EARLIEST remaining segment that is listed here rather than
        // insisting on the next one. Exact text only - a path segment is a known
        // literal string, and a fuzzy match here would drill into the wrong
        // directory tree, which is the failure mode worth avoiding most.
        let at = -1, hit = null;
        for (let k = si; k < segs.length; k++) {
          const m = cur.find(el => (el.textContent || '').trim() === segs[k]);
          if (m) { at = k; hit = m; break; }
        }
        if (!hit) break;
        if (!tryFiberClick(hit)) fireClick(hit);
        dbg.walked.push(segs[at]);
        si = at + 1;
        landed = si >= segs.length;
        if (landed) break;
        await sleep(450);
        if (!dlg.isConnected) break;
        cur = listEntries();
      }
      dbg.exactMatchFound = landed;
      if (landed) {
        await sleep(300);
        const selectBtn = [...dlg.querySelectorAll('button')]
          .filter(b => b.offsetParent)
          .find(b => /^select folder$/i.test((b.textContent || '').trim()));
        dbg.selectFolderBtnFound = !!selectBtn;
        if (selectBtn) { if (!tryFiberClick(selectBtn)) fireClick(selectBtn); await sleep(200); }
      }
    }
    localStorage.setItem('cc-ws-debug', JSON.stringify(dbg));
    console.error('[cc-ws-debug]', JSON.stringify(dbg));
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
  document.body.click();
}

// A project row: oversized emoji + name, or emoji alone when the caller asks
// for a compact tile. Compactness is decided by the caller (only the Local
// grid opts in) - deriving it from emojiOnly() here used to make emoji-less
// folders render a full-width named row inside the dense wrap grid, which
// forced one item per line.
function makeFolderBtn(conn, folder, wsRow, opts = {}) {
  const raw = folder.split('/').filter(Boolean).pop() || folder;
  const {emoji, text} = splitEmoji(raw);
  const mode = opts.mode || 'short';
  const compact = mode === 'emoji' && !!emoji;
  const host = opts.remote ? conn : null;

  const b = document.createElement('button');
  b.type = 'button';
  b.title = folder;
  // Slightly taller than it needs to be on purpose: these are 11px rows in a
  // dense grid, and an extra pixel of padding is the difference between hitting
  // the project you meant and the one below it.
  b.style.cssText = 'box-sizing:border-box;display:flex;align-items:center;gap:5px;text-align:left;' +
    'border:0;border-radius:4px;background:transparent;color:inherit;' +
    'font:inherit;font-size:11px;cursor:pointer;' +
    (compact
      // A real square, so the hit target matches the glyph you can see.
      ? 'padding:0;width:' + TILE_PX + 'px;height:' + TILE_PX + 'px;flex:none;justify-content:center;'
      : 'padding:3px 6px;line-height:1.6;width:100%;') +
    (mode === 'full' ? 'align-items:flex-start;' : '');

  if (emoji) {
    const e = document.createElement('span');
    e.style.cssText = compact ? TILE_CSS : EMOJI_CSS;
    e.textContent = emoji;
    b.appendChild(e);
  }
  if (!compact) {
    const t = document.createElement('span');
    const label = emoji ? text : raw;
    if (mode === 'full') {
      // Wrap rather than clip: "full" has to mean the name is actually readable,
      // otherwise it's just "short" with a wider box.
      t.style.cssText = 'min-width:0;overflow-wrap:anywhere;white-space:normal;';
      t.textContent = label;
    } else {
      t.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      t.textContent = shortText(label);
    }
    b.appendChild(t);
  }

  // ── open-TODO indicator ───────────────────────────────────────────────────
  //
  // Every mode shows the number. Emoji mode used to get a bare 6px dot on the
  // assumption that a tile has no room for a digit; it does - 8.5px tabular
  // numerals in a 13px pill clear the glyph's corner - and a dot that only says
  // "something is open here" sends you hunting for the count that the short and
  // full modes hand over directly (2026-08-26).
  //
  // Intensity is stepped, not continuous: at a glance you're asking "is this
  // one quiet, busy, or piling up", and three levels answer that. A gradient
  // would imply a precision the number already gives you. In emoji mode the
  // digit carries the magnitude, so the badge is drawn at full strength there
  // and the stepping only tints the pill in the named modes.
  //
  // The stepping tints the pill's BACKGROUND only (via .cc-l1/.cc-l2 in
  // css.js). It used to be `opacity` on the whole badge, which faded the digit
  // along with the ground - a 3-open project rendered its number at 42%
  // strength, i.e. the quietest projects were also the hardest to read.
  // Colours live in css.js so they can be theme-paired; see the note there.
  const counts = todoCounts(folder);
  if (counts && counts.open > 0) {
    const n = counts.open;
    const level = n >= 10 ? 2 : n >= 4 ? 1 : 0;
    b.title = folder + '  —  ' + n + ' open' +
      (counts.done ? ' of ' + (n + counts.done) : '') +
      (opts.removable ? '  (right-click to forget)' : '');

    if (compact) {
      // The tile is a fixed square and the badge sits on its corner, so the
      // button has to become the positioning context. Nothing else in the tile
      // is positioned, so this is safe.
      b.style.position = 'relative';
      const badge = document.createElement('span');
      badge.className = 'cc-todo-dot';
      badge.style.cssText =
        'position:absolute;top:-1px;right:-1px;min-width:13px;height:13px;padding:0 2.5px;' +
        'box-sizing:border-box;border-radius:7px;display:flex;align-items:center;' +
        'justify-content:center;pointer-events:none;' +
        'font-size:8.5px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;';
      badge.textContent = n > 99 ? '99+' : String(n);
      b.appendChild(badge);
    } else {
      const badge = document.createElement('span');
      badge.className = 'cc-todo-pill' + (level ? ' cc-l' + level : '');
      badge.style.cssText =
        'margin-left:auto;flex:none;font-size:9.5px;font-weight:700;' +
        'font-variant-numeric:tabular-nums;line-height:1;padding:1px 4px;' +
        'border-radius:7px;pointer-events:none;';
      badge.textContent = String(n);
      b.appendChild(badge);
    }
  }

  b.onmouseenter = () => { b.style.background = 'var(--bg-200,rgba(128,128,128,.15))'; };
  b.onmouseleave = () => { b.style.background = 'transparent'; };
  // One click does both jobs: opens the workspace AND pins the preview to it.
  // Pinning first, so the pane is already showing the right project while the
  // (async, multi-step, occasionally slow) workspace switch runs.
  b.onclick = e => {
    e.stopPropagation();
    pinTodoPreview(folder, host);
    clickWorkspace(conn, folder, wsRow);
  };
  // Right-click forgets a recorded entry. Only offered where it does something:
  // the Local list comes from cc-folders.json, so removing it from cc-ws-v4
  // wouldn't make the tile disappear. No confirm dialog - the entry re-records
  // itself the next time the workspace is actually used.
  if (opts.removable) {
    // Only when the TODO badge hasn't already written a richer title (which
    // includes the same hint) - otherwise the count is thrown away here.
    if (!counts || !counts.open) b.title = folder + '  (right-click to forget)';
    b.oncontextmenu = e => {
      e.preventDefault();
      e.stopPropagation();
      forgetWS(conn, folder);
    };
  }
  // Local folders read from the baked snapshot or the local-fs bridge; remote
  // ones are fetched over ssh on demand (see fetchDoc / cc-read-remote). Hooked
  // up unconditionally so a folder without a TODO.md clears the pane instead of
  // leaving the previous project's list sitting there.
  b.addEventListener('mouseenter', () => showTodoPreview(folder, {host}));
  return b;
}

function colHeader(label) {
  const hdr = document.createElement('div');
  hdr.style.cssText = 'font-size:10px;font-weight:600;opacity:.5;text-transform:uppercase;' +
    'letter-spacing:.05em;margin-bottom:4px;padding:0 2px;';
  hdr.textContent = label;
  return hdr;
}

const hasEmoji = f => !!splitEmoji(f.split('/').filter(Boolean).pop() || f).emoji;

// Layout follows the name mode: emoji is a dense wrap of tiles, short is two
// columns of clipped names, full is one column of complete ones. Folders with no
// emoji have nothing to show as a tile, so in emoji mode they're dropped from
// the grid rather than rendered as a full-width named row (which broke the wrap
// layout).
function folderGrid(conn, folders, wsRow, opts = {}) {
  const grid = document.createElement('div');
  const mode = opts.mode || 'short';
  if (mode === 'emoji') {
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;';
    folders = folders.filter(hasEmoji);
  } else if (mode === 'short' && folders.length > 4) {
    // minmax(0,1fr), not 1fr. A grid item defaults to min-width:auto, so it
    // refuses to shrink below its content and overflows its track instead -
    // which is how the Local column's second column ended up painted 96px into
    // the Remote column. Measured on the real folder list: 14 of 25 rows spilled.
    // The 16px column gutter is deliberate breathing room, not decoration: with
    // 6px there was no safe path for the pointer between two columns of rows.
    grid.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 16px;';
  }
  for (const folder of folders) grid.appendChild(makeFolderBtn(conn, folder, wsRow, opts));
  return grid;
}

// The mode this column will actually use: emoji mode falls back to short when
// the column has no emoji to show, rather than rendering as empty.
function columnMode(folders) {
  const m = nameMode();
  return (m === 'emoji' && !folders.some(hasEmoji)) ? 'short' : m;
}

function buildColumn(conn, folders, wsRow) {
  const col = document.createElement('div');
  col.style.cssText = 'flex:1;min-width:0;';
  col.appendChild(colHeader(conn));
  if (!folders.length) {
    const hint = document.createElement('div');
    hint.textContent = 'No projects found';
    hint.style.cssText = 'font-size:10px;opacity:.35;padding:2px 4px;';
    col.appendChild(hint);
  } else {
    col.appendChild(folderGrid(conn, folders, wsRow, {mode: columnMode(folders)}));
  }
  return col;
}

// All non-Local connections share ONE column, each host a small subheading -
// a separate column per host wastes horizontal space when most hosts only
// have a folder or two. Remote folders are never compacted: they're server
// paths (/root/000_myagents/...) with no emoji convention, so an emoji-only
// remote column would be empty. They're also the only removable entries -
// they come from cc-ws-v4, not from the baked folder list.
function buildRemoteColumn(groups, wsRow) {
  const col = document.createElement('div');
  col.style.cssText = 'flex:1;min-width:0;';
  col.appendChild(colHeader('Remote'));
  const hosts = Object.keys(groups).sort();
  if (!hosts.length) {
    const hint = document.createElement('div');
    hint.textContent = 'No remote folders yet';
    hint.style.cssText = 'font-size:10px;opacity:.35;padding:2px 4px;';
    col.appendChild(hint);
    return col;
  }
  for (const host of hosts) {
    // The host name is a button: it opens the file browser at the server's
    // root. Recorded folders only ever cover places you have already been, and
    // a server you have never opened in this app would otherwise be a dead
    // heading. This makes every configured host reachable on day one.
    const sub = document.createElement('button');
    sub.type = 'button';
    sub.title = 'Browse ' + host + ' over ssh';
    sub.style.cssText = 'display:block;width:100%;text-align:left;border:0;background:transparent;' +
      'color:inherit;font:inherit;font-size:9px;font-weight:600;opacity:.45;' +
      'margin:4px 0 1px;padding:0 2px;cursor:pointer;';
    sub.textContent = host + '  ⤢';
    sub.onmouseenter = () => { sub.style.opacity = '.8'; };
    sub.onmouseleave = () => { sub.style.opacity = '.45'; };
    sub.onclick = e => {
      e.stopPropagation();
      pinTodoPreview('/', host);
      setBrowsing(true);
    };
    col.appendChild(sub);
    // A configured host we have never seen a folder for. Saying so beats
    // omitting the host, which reads as "this server doesn't exist".
    if (!groups[host].length) {
      const none = document.createElement('div');
      none.textContent = 'no folders recorded yet';
      none.style.cssText = 'font-size:9px;opacity:.3;padding:1px 4px 3px;';
      col.appendChild(none);
      continue;
    }
    // Never emoji mode here - these are server paths with no emoji convention,
    // so the tile grid would come out empty. `remote:true` is what routes their
    // previews through the ssh reader instead of the local snapshot.
    col.appendChild(folderGrid(host, groups[host], wsRow, {
      removable: true, remote: true,
      mode: nameMode() === 'emoji' ? 'short' : nameMode(),
    }));
  }
  return col;
}

// Safe markdown → DOM renderer for TODO preview. No innerHTML - XSS-safe.
function _mdInline(parent, text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g);
  for (const p of parts) {
    if (!p) continue;
    if (/^\*\*[^*]+\*\*$/.test(p)) {
      const b = document.createElement('strong'); b.textContent = p.slice(2, -2); parent.appendChild(b);
    } else if (/^\*[^*]+\*$/.test(p)) {
      const i = document.createElement('em'); i.textContent = p.slice(1, -1); parent.appendChild(i);
    } else if (/^_[^_]+_$/.test(p)) {
      const i = document.createElement('em'); i.textContent = p.slice(1, -1); parent.appendChild(i);
    } else if (/^`[^`]+`$/.test(p)) {
      const c = document.createElement('code');
      c.style.cssText = 'font-family:monospace;font-size:10px;background:rgba(128,128,128,.18);padding:0 3px;border-radius:3px;';
      c.textContent = p.slice(1, -1); parent.appendChild(c);
    } else {
      parent.appendChild(document.createTextNode(p));
    }
  }
}

function renderMarkdownInto(el, text) {
  el.textContent = '';
  let list = null;
  const endList = () => { list = null; };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { endList(); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (h) {
      endList();
      const lvl = h[1].length;
      const hd = document.createElement('div');
      hd.style.cssText = `font-weight:700;margin:6px 0 2px;font-size:${lvl <= 1 ? 12 : 11}px;opacity:.9;`;
      _mdInline(hd, h[2]); el.appendChild(hd);
    } else if (task) {
      if (!list) { list = document.createElement('div'); el.appendChild(list); }
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:5px;align-items:baseline;';
      const box = document.createElement('span');
      box.textContent = /x/i.test(task[1]) ? '☑' : '☐';
      box.style.opacity = '.8';
      const txt = document.createElement('span');
      if (/x/i.test(task[1])) txt.style.cssText = 'opacity:.55;text-decoration:line-through;';
      _mdInline(txt, task[2]);
      row.appendChild(box); row.appendChild(txt); list.appendChild(row);
    } else if (bullet || num) {
      if (!list) { list = document.createElement('div'); el.appendChild(list); }
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:5px;align-items:baseline;';
      const dot = document.createElement('span'); dot.textContent = '•'; dot.style.opacity = '.6';
      const txt = document.createElement('span');
      _mdInline(txt, (bullet || num)[1]);
      row.appendChild(dot); row.appendChild(txt); list.appendChild(row);
    } else if (quote) {
      endList();
      const q = document.createElement('div');
      q.style.cssText = 'border-left:2px solid var(--claude-border,rgba(128,128,128,.4));' +
        'padding-left:6px;margin:2px 0;opacity:.75;';
      _mdInline(q, quote[1]);
      el.appendChild(q);
    } else {
      endList();
      const p = document.createElement('div');
      p.style.margin = '2px 0';
      _mdInline(p, line);
      el.appendChild(p);
    }
  }
}


// ─────────────────────────────────────────────────────────────
//  PANEL SHELL + GEOMETRY
//
//  The panel used to be one absolutely-positioned box, anchored
//  `bottom:calc(100% + 6px)` on the workspace row, whose height was whatever
//  its contents happened to be. Both of the things that made it unusable came
//  straight out of that:
//
//   - Jitter. The TODO preview sat UNDER the project rows inside a
//     bottom-anchored box, so previewing a long TODO grew the box downward-
//     resistant top edge, i.e. it pushed every project row upward. Moving the
//     rows out from under the cursor swaps which project is hovered, which
//     swaps the preview, which moves the rows again. Hovering a list and having
//     it walk away is exactly that feedback loop.
//   - Cropping at zoom. Height was clamped to the space above the row. Browser
//     zoom shrinks the viewport in CSS pixels, so that space collapses and the
//     panel became a scrolling sliver.
//
//  Both are geometry problems, not content problems, so the fix is geometry:
//  the panel is now a FIXED-size box (width and height computed from the
//  viewport, never from its contents) with two independently-scrolling panes.
//  Hovering a project repaints the preview pane and changes nothing else on
//  screen. When there genuinely isn't room above the row, it stops trying to
//  fit there and anchors to the viewport instead.
// ─────────────────────────────────────────────────────────────
const WS_MARGIN   = 12;   // keep-out from every viewport edge
const WS_GAP      = 6;    // gap between the panel and the workspace row
// Target size scales with the window rather than being a fixed 760x330 box. On
// a maximised window that box used ~40% of the width and showed maybe half the
// projects and a dozen TODO lines, with the rest behind two scrollbars, for no
// reason - the space was there. These are still only TARGETS: clampPanel takes
// the smaller of this and what actually fits, so a small window or a zoomed page
// behaves exactly as it did.
const WS_MAX_W    = 1280;
const WS_MAX_H    = 720;
const WS_FRAC_W   = 0.72;  // of viewport width
const WS_FRAC_H   = 0.62;  // of viewport height
const WS_MIN_H    = 210;   // below this, anchoring above the row isn't worth it
const WS_PREV_FR  = 0.38;  // preview pane's share of the panel width
const WS_PREV_MIN = 300;   // ...but never squeezed below this
const WS_STACK_W  = 560;   // narrower than this, stack the panes instead

const wsTargetW = vw => Math.min(WS_MAX_W, Math.max(760, Math.round(vw * WS_FRAC_W)));
const wsTargetH = vh => Math.min(WS_MAX_H, Math.max(330, Math.round(vh * WS_FRAC_H)));

const COLLAPSE_KEY = 'cc-ws-collapsed';
const wsCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } };
const setWsCollapsed = v => { try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch {} };

let _prevTitle = null, _prevBody = null, _prevEdit = null, _prevBar = null, _prevSel = null;
let _prevFolder = null;   // the PROJECT the preview belongs to
let _prevDir = null;      // the directory being shown - the project, or below it
let _prevHost = null;     // null for Local, else the SSH connection name
let _prevFile = 'TODO.md';
let _browsing = false;    // file-browser view instead of the document view
let _editing = false;
let _saveTimer = null;
let _preEditText = null;  // in-memory undo for the whole editing session

// Pinning. Hovering a project previews it; CLICKING one (which is also how you
// open it as a workspace) pins the preview to it, and from then on hovering
// anything else leaves the pane alone.
//
// This is what makes the pane usable at all. Reaching it with the mouse means
// crossing other project rows, and every row crossed used to repaint the pane -
// so the preview you were trying to read was gone before you got there. The
// gutter between the columns was widened for the same reason, but a wider gutter
// only helps the projects at the edge; pinning helps every one of them, and it
// is the only thing that works in emoji mode where the tiles are packed 3px
// apart.
//
// The pin is released from the "unpin" button in the preview header - deliberately
// an explicit action, because a pin that clears itself on some subtle condition
// is just the jitter again with extra steps.
let _pinFolder = null, _pinHost = null;

const TODO_FILE = 'TODO.md';

// Cache of {ok, text, error, at} per (host, folder, file). Remote reads go over
// ssh and can take a second, so re-hovering the same tile must not re-run them;
// failures are cached only briefly so a host that comes back up is retried.
const _docCache = new Map();
const _docPending = new Set();
const DOC_FAIL_TTL = 20000;
const docKey = (host, folder, file) => (host || '') + '' + folder + '' + file;

function cachedDoc(host, folder, file) {
  const hit = _docCache.get(docKey(host, folder, file));
  if (!hit) return null;
  if (!hit.ok && Date.now() - hit.at > DOC_FAIL_TTL) return null;
  return hit;
}

// Resolves to {ok, text, error}. Four sources, in order of cheapness: the cache,
// the TODO text baked in at patch time, the local-fs bridge, and ssh.
async function fetchDoc(host, folder, file) {
  const key = docKey(host, folder, file);
  const hit = cachedDoc(host, folder, file);
  if (hit) return hit;
  if (_docPending.has(key)) return {ok: false, error: 'loading', at: Date.now()};
  _docPending.add(key);
  let out;
  try {
    if (host) {
      out = window.ccBridge && window.ccBridge.readRemote
        ? await window.ccBridge.readRemote(host, folder, file)
        : {ok: false, error: 'no remote bridge - re-run update-ui.sh'};
    } else {
      const baked = file === TODO_FILE ? ccTodo(folder) : undefined;
      if (baked != null) out = {ok: true, text: baked};
      else if (window.ccBridge && window.ccBridge.readDoc) {
        out = await window.ccBridge.readDoc(folder, file);
      } else out = {ok: false, error: 'no bridge - re-run update-ui.sh'};
    }
  } catch (e) {
    out = {ok: false, error: String((e && e.message) || e)};
  } finally {
    _docPending.delete(key);
  }
  out = Object.assign({ok: false, text: null, error: 'no response'}, out || {}, {at: Date.now()});
  _docCache.set(key, out);
  return out;
}


// Rendered view and edit view are two elements in the same slot, so switching
// between them can't change the pane's geometry (the whole point of #22).
// Click the text to edit, click anywhere else to go back to reading it - no
// edit/done button to hunt for.
function setEditing(on) {
  if (!_prevBody) return;
  // Remote folders are read-only: the ssh bridge reads, it does not write.
  // Offering an editor that silently fails to save would be worse than not
  // offering one.
  const want = !!on && !!_prevFolder && !_prevHost;
  if (want === _editing) return;
  _editing = want;
  _prevBody.style.display = _editing ? 'none' : '';
  _prevEdit.style.display = _editing ? '' : 'none';
  _prevBar.revertBtn.style.display = _editing ? '' : 'none';
  if (_editing) {
    const hit = cachedDoc(null, _prevDir || _prevFolder, _prevFile);
    _preEditText = (hit && hit.ok && hit.text) || '';
    _prevEdit.value = _preEditText;
    _prevEdit.focus();
  } else {
    // Leaving the editor is a commit point: don't wait out the debounce.
    flushSave();
    renderPreview();
  }
}

// Restores the text as it was when this editing session started. The on-disk
// backups (see cc-write-todo) cover everything older; this covers the case that
// actually happens, which is selecting all and typing over it by accident.
function revertEdit() {
  if (!_editing || _preEditText == null) return;
  _prevEdit.value = _preEditText;
  saveTodoSoon();
  _prevEdit.focus();
}

function setSaveState(msg, bad) {
  if (!_prevBar) return;
  _prevBar.status.textContent = msg || '';
  _prevBar.status.style.color = bad ? '#ef4444' : 'inherit';
}

// Writes through ccBridge.writeDoc -> cc-write-doc-v2 ipcMain handler, which is
// the only process with fs access. Debounced: this fires on every keystroke.
// Falls back to the older TODO-only channel so an app patched by a previous
// version of update-ui.sh still saves TODO.md rather than reporting "no bridge".
async function doSave(folder, file, text) {
  const b = window.ccBridge;
  const canDoc  = b && typeof b.writeDoc === 'function';
  const canTodo = b && typeof b.writeTodo === 'function';
  if (!canDoc && !(canTodo && file === TODO_FILE)) {
    setSaveState('no bridge', true);
    return;
  }
  try {
    const r = canDoc ? await b.writeDoc(folder, file, text) : await b.writeTodo(folder, text);
    if (r && r.ok) {
      // Keep the in-memory copies in step so hovering away and back, or
      // re-rendering the panel, doesn't resurrect the pre-edit text.
      _docCache.set(docKey(null, folder, file), {ok: true, text, at: Date.now()});
      if (file === TODO_FILE) {
        if (typeof window.__CC_TODOS__ !== 'object' || !window.__CC_TODOS__) window.__CC_TODOS__ = {};
        window.__CC_TODOS__[folder] = text;
      }
      setSaveState('saved');
      setTimeout(() => { if (_prevBar && _prevBar.status.textContent === 'saved') setSaveState(''); }, 1500);
    } else {
      setSaveState((r && r.error) ? String(r.error).slice(0, 40) : 'save failed', true);
    }
  } catch (e) {
    setSaveState('save failed', true);
    console.error('[cc-ws] writeDoc', e);
  }
}

function saveTodoSoon() {
  if (!_prevFolder || _prevHost) return;
  const folder = _prevDir || _prevFolder, file = _prevFile, text = _prevEdit.value;
  setSaveState('…');
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => doSave(folder, file, text), 600);
}

// Write now rather than in 600ms. Called when the editor closes and on unload,
// so a pending keystroke can't be lost by clicking away or quitting.
function flushSave() {
  if (!_saveTimer || !_prevFolder || !_prevEdit) return;
  clearTimeout(_saveTimer);
  _saveTimer = null;
  doSave(_prevDir || _prevFolder, _prevFile, _prevEdit.value);
}

// ── preview pane ────────────────────────────────────────────────────────────

const isPinned = () => !!_pinFolder;
const pinnedHere = () => _pinFolder === _prevFolder && _pinHost === _prevHost;

function pinTodoPreview(folder, host) {
  _pinFolder = folder;
  _pinHost = host || null;
  showTodoPreview(folder, {host, force: true});
}

function unpinTodoPreview() {
  _pinFolder = _pinHost = null;
  renderPreview();
}

// Every repaint is tagged, so a slow ssh read that lands after the user has
// moved on can't overwrite the pane with the previous folder's file.
let _renderSeq = 0;

function showTodoPreview(folder, opts = {}) {
  if (!_prevTitle || !_prevBody) return;
  const host = opts.host || null;
  // Don't yank the pane out from under an in-progress edit just because the
  // pointer crossed another project on its way to the textarea.
  if (_editing && folder !== _prevFolder) return;
  // Pinned to something else: hovering does nothing.
  if (!opts.force && isPinned() && (folder !== _pinFolder || host !== _pinHost)) return;
  const changed = folder !== _prevFolder || host !== _prevHost;
  _prevFolder = folder;
  _prevHost = host;
  if (changed) { _prevFile = TODO_FILE; _prevDir = folder; _browsing = false; }
  renderPreview();
  if (changed) refreshFileList();
}

function paintDoc(seq, file, r) {
  if (seq !== _renderSeq) return;
  if (r && r.ok && r.text) renderMarkdownInto(_prevBody, r.text);
  else if (r && r.ok) _prevBody.textContent = file + ' is empty.';
  else if (r && r.error === 'loading') _prevBody.textContent = 'Reading ' + file + '…';
  else _prevBody.textContent = 'No ' + file + ' here' +
    (r && r.error ? ' (' + String(r.error).slice(0, 120) + ')' : '') + '.';
}

// ── file browser ────────────────────────────────────────────────────────────
//
// The app has a perfectly good file panel on ctrl+shift+F, and it is unavailable
// on exactly the page where you are choosing what to work on - it only exists
// once a session has started. Since the panel already knows which project you
// mean and already has a pane, it can answer the same question here.
//
// Reuses the preview pane rather than adding a third column: browsing and
// reading are the same activity, and the pane is already the right shape for it.
// ctrl+shift+F toggles it, but only when our panel is on screen - inside a chat
// the app's own shortcut is the better one and is left alone.

const TEXTY = /\.(md|txt|markdown|text)$/i;

function setBrowsing(on) {
  if (!_prevFolder) return;
  setEditing(false);
  _browsing = !!on;
  if (_browsing) _prevDir = _prevDir || _prevFolder;
  renderPreview();
}

// Never above the project itself: the browser is for looking inside a project,
// not for wandering the filesystem.
const parentDir = d => {
  const up = d.split('/').slice(0, -1).join('/');
  return up.length >= _prevFolder.length ? up : null;
};

function browseRow(label, icon, dim, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%;text-align:left;' +
    'border:0;background:transparent;color:inherit;font:inherit;font-size:11px;' +
    'padding:2px 4px;border-radius:4px;' + (dim ? 'opacity:.45;' : 'cursor:pointer;');
  const i = document.createElement('span');
  i.textContent = icon;
  i.style.cssText = 'flex:none;opacity:.75;';
  const t = document.createElement('span');
  t.textContent = label;
  t.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  b.appendChild(i);
  b.appendChild(t);
  if (!dim) {
    b.onmouseenter = () => { b.style.background = 'var(--bg-200,rgba(128,128,128,.15))'; };
    b.onmouseleave = () => { b.style.background = 'transparent'; };
    b.onclick = e => { e.stopPropagation(); onClick(); };
  }
  return b;
}

function renderBrowse() {
  const dir = _prevDir, host = _prevHost;
  const seq = ++_renderSeq;
  _prevBody.textContent = 'Reading…';
  const p = host
    ? (window.ccBridge && window.ccBridge.listTreeRemote
        ? window.ccBridge.listTreeRemote(host, dir) : Promise.resolve(null))
    : (window.ccBridge && window.ccBridge.listTree
        ? window.ccBridge.listTree(dir, '') : Promise.resolve(null));
  Promise.resolve(p).then(r => {
    if (seq !== _renderSeq) return;
    _prevBody.textContent = '';
    if (!r || !r.ok) {
      _prevBody.textContent = 'Could not read this folder' +
        (r && r.error ? ' (' + String(r.error).slice(0, 120) + ')' : '') + '.';
      return;
    }
    const up = parentDir(dir);
    if (up) _prevBody.appendChild(browseRow('..', '↰', false, () => {
      _prevDir = up; renderPreview();
    }));
    for (const e of r.entries) {
      if (e.dir) {
        _prevBody.appendChild(browseRow(e.name, '📁', false, () => {
          _prevDir = (dir.endsWith('/') ? dir : dir + '/') + e.name;
          renderPreview();
        }));
      } else if (TEXTY.test(e.name)) {
        _prevBody.appendChild(browseRow(e.name, '📄', false, () => {
          _prevFile = e.name; _browsing = false; renderPreview(); refreshFileList();
        }));
      } else {
        // Shown but not openable - the pane renders markdown, not binaries, and
        // a listing with holes in it is worse than one with greyed-out rows.
        _prevBody.appendChild(browseRow(e.name, '·', true, null));
      }
    }
    if (!r.entries.length) _prevBody.textContent = 'This folder is empty.';
  }).catch(() => {
    if (seq === _renderSeq) _prevBody.textContent = 'Could not read this folder.';
  });
}

function renderPreview() {
  if (!_prevTitle || !_prevBody) return;
  const folder = _prevFolder, host = _prevHost, file = _prevFile;
  if (!folder) {
    _prevTitle.textContent = 'TODO.md';
    _prevBody.textContent = 'Hover a project to preview its TODO.md. Click one to keep it here.';
    if (_prevBar) {
      _prevBar.openBtn.style.display = 'none';
      _prevBar.pinBtn.style.display = 'none';
    }
    if (_prevSel) _prevSel.style.display = 'none';
    return;
  }
  const dir = _prevDir || folder;
  const name = emojiSuffix(folder.split('/').filter(Boolean).pop() || folder);
  // Remote entries are server paths, so the path IS the useful label. Local ones
  // are named projects, so show the name plus however far below it we are.
  const sub = (!host && dir.length > folder.length) ? ' / ' + dir.slice(folder.length + 1) : '';
  _prevTitle.textContent = (pinnedHere() ? '📌 ' : '') +
    (host ? host + ' · ' + dir : name + sub);
  _prevTitle.title = (host ? host + ':' : '') + dir;
  // The pane keeps its scroll offset between projects; without this a long
  // previous TODO leaves the next one already scrolled past its own heading.
  _prevBody.scrollTop = 0;
  _prevBody.style.cursor = (host || _browsing) ? 'default' : 'text';
  _prevBody.title = _browsing ? 'Click a folder to open it, a file to read it'
    : host ? 'Remote folder - read only'
    : 'Click to edit. Click anywhere else to go back to reading.';
  if (_prevBar) {
    _prevBar.openBtn.style.display = host ? 'none' : '';
    _prevBar.pinBtn.style.display = isPinned() ? '' : 'none';
    _prevBar.filesBtn.style.display = '';
    _prevBar.filesBtn.textContent = _browsing ? 'read' : 'files';
    _prevBar.filesBtn.title = _browsing
      ? 'Back to reading the file'
      : 'Browse this project’s files and folders (ctrl+shift+F)';
    setSaveState('');
  }
  if (_prevSel) _prevSel.style.display = _browsing ? 'none' : _prevSel.style.display;

  if (_browsing) { renderBrowse(); return; }

  const seq = ++_renderSeq;
  const hit = cachedDoc(host, dir, file);
  if (hit) { paintDoc(seq, file, hit); return; }
  _prevBody.textContent = 'Reading ' + file + '…';
  fetchDoc(host, dir, file).then(r => paintDoc(seq, file, r));
}

// Which files this folder offers. TODO.md is always the first option even when
// the listing fails, so the dropdown never comes back empty.
async function refreshFileList() {
  if (!_prevSel) return;
  const folder = _prevFolder, host = _prevHost, dir = _prevDir || _prevFolder;
  let files = [TODO_FILE];
  try {
    const b = window.ccBridge;
    const r = host
      ? (b && b.listRemote ? await b.listRemote(host, dir) : null)
      : (b && b.listDocs ? await b.listDocs(dir) : null);
    if (r && r.ok && Array.isArray(r.files) && r.files.length) files = r.files;
  } catch (_) {}
  // The user may have moved on while the listing was in flight.
  if (folder !== _prevFolder || host !== _prevHost || dir !== (_prevDir || _prevFolder)) return;
  if (!files.includes(TODO_FILE)) files.unshift(TODO_FILE);
  _prevSel.textContent = '';
  for (const f of files) {
    const o = document.createElement('option');
    o.value = f;
    o.textContent = f;
    _prevSel.appendChild(o);
  }
  if (!files.includes(_prevFile)) _prevFile = files[0];
  _prevSel.value = _prevFile;
  _prevSel.style.display = files.length > 1 ? '' : 'none';
}

// Builds the static chrome once. rebuildPanel() only ever refills `list`, so
// the box itself never gets torn down and rebuilt under the cursor.
function buildShell(panel) {
  const head = document.createElement('div');
  head.style.cssText = 'flex:none;display:flex;align-items:center;gap:8px;' +
    'font-size:10px;font-weight:600;opacity:.55;text-transform:uppercase;' +
    'letter-spacing:.05em;margin-bottom:6px;';

  const htitle = document.createElement('span');
  htitle.textContent = 'Projects';
  htitle.style.cssText = 'flex:1;min-width:0;';
  head.appendChild(htitle);

  // Emoji / Short / Full, as real radios - one group, one visible choice, no
  // guessing what a checkbox that says "emoji only" does when it's off.
  const modes = document.createElement('div');
  modes.style.cssText = 'display:flex;align-items:center;gap:8px;flex:none;' +
    'font-size:9px;font-weight:600;opacity:.75;text-transform:none;letter-spacing:0;';
  const current = nameMode();
  for (const m of NAME_MODES) {
    const lab = document.createElement('label');
    lab.style.cssText = 'display:flex;align-items:center;gap:3px;cursor:pointer;';
    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'cc-ws-name-mode';
    rb.value = m;
    rb.checked = m === current;
    rb.style.cssText = 'margin:0;cursor:pointer;';
    rb.onclick = e => e.stopPropagation();
    rb.onchange = () => { if (rb.checked) { setNameMode(m); rebuildPanel(); } };
    lab.appendChild(rb);
    lab.appendChild(document.createTextNode(m));
    lab.onclick = e => e.stopPropagation();
    modes.appendChild(lab);
  }
  head.appendChild(modes);

  // Collapse exists for the zoomed-in case: at 150%+ the panel legitimately
  // covers most of the window, and you want it out of the way between uses.
  const coll = document.createElement('button');
  coll.type = 'button';
  coll.style.cssText = 'flex:none;border:0;background:transparent;color:inherit;' +
    'cursor:pointer;font:inherit;font-size:11px;line-height:1;padding:2px 4px;opacity:.8;';
  coll.onclick = e => {
    e.stopPropagation();
    setWsCollapsed(!wsCollapsed());
    applyCollapsed(panel);
    clampPanel(panel);
  };
  head.appendChild(coll);

  const body = document.createElement('div');
  body.style.cssText = 'flex:1;display:flex;gap:8px;min-height:0;min-width:0;';

  const list = document.createElement('div');
  list.style.cssText = 'flex:1 1 auto;min-width:0;overflow:auto;';

  const prev = document.createElement('div');
  prev.style.cssText = 'flex:none;display:flex;flex-direction:column;min-height:0;min-width:0;';

  const phead = document.createElement('div');
  phead.style.cssText = 'flex:none;display:flex;align-items:baseline;gap:6px;margin-bottom:4px;';

  const ptitle = document.createElement('div');
  ptitle.style.cssText = 'flex:1;min-width:0;font-size:10px;font-weight:600;opacity:.55;' +
    'text-transform:uppercase;letter-spacing:.05em;' +
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

  const pstatus = document.createElement('span');
  pstatus.style.cssText = 'flex:none;font-size:9px;opacity:.6;min-width:30px;text-align:right;';

  const mkAction = (label, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.style.cssText = 'flex:none;border:0;background:transparent;color:inherit;cursor:pointer;' +
      'font:inherit;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;' +
      'opacity:.7;padding:1px 3px;border-radius:3px;';
    b.onmouseenter = () => { b.style.background = 'var(--bg-200,rgba(128,128,128,.18))'; };
    b.onmouseleave = () => { b.style.background = 'transparent'; };
    return b;
  };

  // Which file the pane is showing. Hidden when a folder only has TODO.md, so
  // the common case looks exactly like it did before.
  const psel = document.createElement('select');
  psel.style.cssText = 'flex:none;max-width:130px;border:0;background:transparent;color:inherit;' +
    'font:inherit;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;' +
    'opacity:.75;cursor:pointer;padding:0;display:none;';
  psel.title = 'Which file to show from this folder';
  psel.onclick = e => e.stopPropagation();
  psel.onchange = e => {
    e.stopPropagation();
    setEditing(false);
    _prevFile = psel.value;
    renderPreview();
  };
  _prevSel = psel;

  const revertBtn = mkAction('revert', 'Put the text back to how it was when you started editing');
  revertBtn.style.display = 'none';
  revertBtn.onclick = e => { e.stopPropagation(); revertEdit(); };

  // Visible only while something is pinned - there is nothing to clear otherwise,
  // and a permanently-present button that usually does nothing reads as broken.
  const pinBtn = mkAction('unpin', 'Stop holding this project - go back to previewing whatever you hover');
  pinBtn.style.display = 'none';
  pinBtn.onclick = e => { e.stopPropagation(); unpinTodoPreview(); };

  const filesBtn = mkAction('files', 'Browse this project’s files and folders (ctrl+shift+F)');
  filesBtn.style.display = 'none';
  filesBtn.onclick = e => { e.stopPropagation(); setBrowsing(!_browsing); };
  // The one-click "open the folder" the panel was missing: ccBridge.openFolder
  // already existed for this, wired to shell.openPath in the main process.
  const openBtn = mkAction('open', 'Open this folder in the file manager');
  openBtn.onclick = e => {
    e.stopPropagation();
    if (_prevFolder && window.ccBridge?.openFolder) window.ccBridge.openFolder(_prevFolder);
  };

  phead.appendChild(ptitle);
  phead.appendChild(psel);
  phead.appendChild(pstatus);
  phead.appendChild(revertBtn);
  phead.appendChild(filesBtn);
  phead.appendChild(pinBtn);
  phead.appendChild(openBtn);

  const pbody = document.createElement('div');
  pbody.style.cssText = 'flex:1;min-height:0;overflow:auto;font-size:11px;line-height:1.4;' +
    'word-break:break-word;opacity:.85;font-family:inherit;cursor:text;';
  pbody.title = 'Click to edit. Click anywhere else to go back to reading.';
  // In browse mode the pane is a list of buttons, and a click on the padding
  // between them must not drop into the editor.
  pbody.onclick = e => { e.stopPropagation(); if (!_browsing) setEditing(true); };

  const pedit = document.createElement('textarea');
  pedit.spellcheck = false;
  pedit.style.cssText = 'display:none;box-sizing:border-box;flex:1;min-height:0;width:100%;' +
    'resize:none;border:1px solid var(--claude-border,rgba(128,128,128,.35));border-radius:5px;' +
    'padding:6px;background:rgba(255,255,255,.35);color:inherit;' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.45;';
  pedit.oninput = saveTodoSoon;
  // Keystrokes inside the panel must not reach the app underneath - Claude
  // binds single-key shortcuts on the document, and typing "n" into a TODO
  // should not start a new chat.
  for (const ev of ['keydown', 'keyup', 'keypress']) {
    pedit.addEventListener(ev, e => {
      e.stopPropagation();
      if (e.key === 'Escape') { setEditing(false); showTodoPreview(_prevFolder); }
    });
  }

  prev.appendChild(phead);
  prev.appendChild(pbody);
  prev.appendChild(pedit);
  _prevEdit = pedit;
  _prevBar = {wrap: phead, status: pstatus, revertBtn, openBtn, pinBtn, filesBtn, sel: psel};
  installEditExitListeners();
  body.appendChild(list);
  body.appendChild(prev);
  panel.appendChild(head);
  panel.appendChild(body);

  panel._els = {head, htitle, coll, body, list, prev, phead, ptitle, pbody, pedit};
  _prevTitle = ptitle;
  _prevBody = pbody;
  applyCollapsed(panel);
}

// Click-away closes the editor. Registered once on the document, in the capture
// phase, so it still fires when the app stops the event on the way up.
let _editExitInstalled = false;
function installEditExitListeners() {
  if (_editExitInstalled) return;
  _editExitInstalled = true;
  document.addEventListener('mousedown', e => {
    if (!_editing) return;
    const t = e.target;
    // Anything inside the textarea or the preview header (revert, open) keeps
    // the editor open; everything else commits and goes back to reading.
    if (_prevEdit && (t === _prevEdit || _prevEdit.contains(t))) return;
    if (_prevBar && _prevBar.wrap.contains(t)) return;
    setEditing(false);
  }, true);
  // ctrl+shift+F opens the panel's file browser - but ONLY when the panel is on
  // screen, which is only ever the new-session page. Inside a chat the app's own
  // file panel is the better one and this must not shadow it.
  document.addEventListener('keydown', e => {
    if (!e.ctrlKey || !e.shiftKey || e.altKey) return;
    if ((e.key || '').toLowerCase() !== 'f') return;
    if (!document.querySelector('.' + PANEL_CLS) || !_prevFolder) return;
    e.preventDefault();
    e.stopPropagation();
    setBrowsing(!_browsing);
  }, true);
  // Quitting or navigating away must not drop an un-flushed keystroke.
  window.addEventListener('beforeunload', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
}

function applyCollapsed(panel) {
  const c = wsCollapsed();
  panel._els.body.style.display = c ? 'none' : 'flex';
  panel._els.head.style.marginBottom = c ? '0' : '6px';
  panel._els.coll.textContent = c ? '▸' : '▾';
  panel._els.coll.title = c ? 'Expand project panel' : 'Collapse project panel';
}

function rebuildPanel() {
  const panel = document.querySelector('.' + PANEL_CLS);
  if (!panel?._wsRow || !panel._els) return;
  const ws = loadWS();
  const L = (typeof window.__CC_FOLDERS__ !== 'undefined' && window.__CC_FOLDERS__.length) ? window.__CC_FOLDERS__
    : (typeof CC_AI_LOCAL !== 'undefined') ? CC_AI_LOCAL
    : [...new Set(ws.filter(w => w.conn === 'Local').map(w => w.folder))];
  // Every non-Local connection, grouped by host name, from three sources: what
  // we recorded ourselves (cc-ws-v4), what the APP recorded
  // (desktop-recent-workspaces), and the configured SSH hosts - the last so a
  // server with nothing recorded yet is still visible instead of silently
  // absent, which is what "I'm not seeing projects from my other servers"
  // looked like.
  const remote = {};
  for (const name of (_sshHosts || [])) remote[name] ||= [];
  for (const {conn, folder} of [...ws, ...appRecentWorkspaces()]) {
    if (!conn || conn === 'Local' || !folder) continue;
    // A local path recorded against a connection name is still a local path.
    if (folder.startsWith(HOME_HINT)) continue;
    (remote[conn] ||= []);
    if (!remote[conn].includes(folder)) remote[conn].push(folder);
  }
  loadSshHosts();

  const list = panel._els.list;
  list.textContent = '';
  const cols = document.createElement('div');
  // 22px, and a hairline rule down the middle. The columns used to be 8px
  // apart, which is not a gutter - it's a seam. Crossing from a project in the
  // Local column to the preview pane meant clipping rows in the Remote column on
  // the way, and each one repainted the preview. Pinning is the real fix; this
  // is so the pointer has somewhere to be that isn't a project.
  cols.style.cssText = 'display:flex;gap:22px;align-items:stretch;';
  const localCol = buildColumn('Local', L, panel._wsRow);
  const remoteCol = buildRemoteColumn(remote, panel._wsRow);
  remoteCol.style.borderLeft = '1px solid var(--claude-border,rgba(128,128,128,.18))';
  remoteCol.style.paddingLeft = '18px';
  cols.appendChild(localCol);
  cols.appendChild(remoteCol);
  list.appendChild(cols);

  // A pinned project outranks everything: rebuilding the list (a rename, a new
  // recorded remote) must not quietly drop what the user is reading.
  if (_pinFolder) showTodoPreview(_pinFolder, {host: _pinHost, force: true});
  else {
    const seed = _prevFolder || L.find(f => ccTodo(f));
    if (seed) showTodoPreview(seed, {host: _prevFolder === seed ? _prevHost : null});
    else { _prevFolder = null; _prevHost = null; renderPreview(); }
  }

  clampPanel(panel);
}

function removeAllPanels() {
  document.querySelectorAll('.' + PANEL_CLS).forEach(p => p.remove());
  _prevTitle = _prevBody = null;
}

// The panel now lives on document.body (see installPanel), so nothing removes
// it automatically when its row goes away. Called from the scan loop.
function prunePanels() {
  document.querySelectorAll('.' + PANEL_CLS).forEach(p => {
    if (!p._wsRow || !p._wsRow.isConnected) { p.remove(); _prevTitle = _prevBody = null; }
    else clampPanel(p);
  });
}

function installPanel(wsRow) {
  if (wsRow.dataset.ccRow) return;
  wsRow.dataset.ccRow = '1';
  wsRow.addEventListener('click', () => sampleWS(wsRow), true);
  if (location.pathname.includes('/chat/')) return;
  if (document.querySelector('.' + PANEL_CLS)) return;

  const panel = document.createElement('div');
  panel.className = PANEL_CLS;
  panel._wsRow = wsRow;
  // position:fixed, and parented to <body> rather than to the row. An
  // absolutely-positioned child inherits its containing block from the nearest
  // positioned/transformed ancestor, and claude.ai wraps this row in animated
  // containers - one `transform` anywhere up the tree silently redefines what
  // "fixed" means. Off the row, off the problem.
  //
  // Sepia rather than near-white: monochrome emoji (☑ ⏱ ✂ …) disappear against
  // #faf9f5 but read clearly against a warm ground.
  // box-sizing is explicit because clampPanel sets width/height outright: with
  // the default content-box the 12px padding and 1px border land OUTSIDE the
  // computed size, so the box quietly renders 26px wider than the viewport fit
  // it was just given.
  //
  // z-index 30, NOT the old 2147482000. The panel has to paint over the page's
  // own content (the composer, the new-session overview) and must NOT paint over
  // the app's dialogs and menus - and those are two different jobs for two
  // different numbers, not one number that has to be both. claude.ai's overlays
  // are Radix portals in the z-40/z-50 band; ordinary page content is z-auto. A
  // value between the two lands exactly where it should, and it degrades
  // gracefully: an overlay we've never seen still wins simply by being a portal
  // with a real z-index.
  //
  // The first attempt at this hid the panel whenever an overlay was open, which
  // worked but was the wrong behaviour - a panel that vanishes is harder to
  // reason about than one that is simply behind something.
  panel.style.cssText = 'box-sizing:border-box;position:fixed;z-index:30;display:flex;flex-direction:column;' +
    'background:#f2e8d5;' +
    'border:1px solid var(--claude-border,rgba(128,128,128,.22));' +
    'border-radius:8px;padding:10px 12px;' +
    'box-shadow:0 4px 20px rgba(0,0,0,.16);font-family:inherit;color:inherit;' +
    'overflow:hidden;';  // panes scroll, the box never does
  document.body.appendChild(panel);
  buildShell(panel);
  rebuildPanel();
  installClampListeners();
}

// Zoom and window resize both move the row and change the viewport. Coalesced
// to one clamp per frame across every panel.
let _clampListeners = false;
let _clampRaf = 0;
function scheduleClamp() {
  if (_clampRaf) return;
  _clampRaf = requestAnimationFrame(() => {
    _clampRaf = 0;
    document.querySelectorAll('.' + PANEL_CLS).forEach(clampPanel);
  });
}
function installClampListeners() {
  if (_clampListeners) return;
  _clampListeners = true;
  window.addEventListener('resize', scheduleClamp);
  window.visualViewport?.addEventListener('resize', scheduleClamp);
  window.visualViewport?.addEventListener('scroll', scheduleClamp);
}

// Sets width/height/top/left outright every time. Nothing here reads the
// panel's content size, so hovering a project can never move the box.
function clampPanel(panel) {
  if (!panel?.isConnected || !panel._els) return;
  const row = panel._wsRow;
  if (!row?.isConnected) { panel.remove(); _prevTitle = _prevBody = null; return; }

  const rr = row.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;

  // Never start left of the workspace row. The row lives in the main content
  // column, so its left edge is a reliable stand-in for where the sidebar ends -
  // and the old code did the opposite: when the target width didn't fit it slid
  // the panel LEFT (`left = vw - WS_MARGIN - w`), straight over the session
  // list. On a narrow window that is guaranteed, which is exactly when it was
  // reported. Shrink to fit instead of sliding.
  const minLeft = Math.max(WS_MARGIN, Math.round(rr.left));
  const left = minLeft;
  const w = Math.max(240, Math.min(wsTargetW(vw), vw - WS_MARGIN - left));

  panel.style.width = w + 'px';
  panel.style.left = left + 'px';

  if (wsCollapsed()) {
    // Height follows the single head row; measure after clearing the override.
    panel.style.height = 'auto';
    const h = panel.offsetHeight || 30;
    let top = Math.round(rr.top) - WS_GAP - h;
    if (top < WS_MARGIN) top = Math.max(WS_MARGIN, Math.min(vh - WS_MARGIN - h, Math.round(rr.bottom) + WS_GAP));
    panel.style.top = top + 'px';
    return;
  }

  const above = Math.round(rr.top) - WS_GAP - WS_MARGIN;
  const targetH = wsTargetH(vh);
  let h, top;
  if (above >= WS_MIN_H) {
    h = Math.min(targetH, above);
    top = Math.round(rr.top) - WS_GAP - h;
  } else {
    // Not enough headroom - browser zoom, or a short window. Squeezing into a
    // 60px sliver is what made it useless; anchor to the viewport and accept
    // overlapping the row. The collapse chevron is the way out.
    h = Math.min(targetH, vh - 2 * WS_MARGIN);
    top = WS_MARGIN;
  }
  panel.style.height = h + 'px';
  panel.style.top = top + 'px';

  // Side-by-side needs real width for both panes; below that, stack them so
  // the preview stays reachable instead of being dropped. Either way both
  // dimensions are fixed, so the layout is stable under hover.
  const {body, list, prev} = panel._els;
  if (w >= WS_STACK_W) {
    body.style.flexDirection = 'row';
    // The preview grows with the panel instead of staying a fixed 290px sliver -
    // the whole point of a bigger panel is more TODO on screen, not just more
    // project rows.
    prev.style.width = Math.max(WS_PREV_MIN, Math.round(w * WS_PREV_FR)) + 'px';
    prev.style.height = '';
    prev.style.borderLeft = '1px solid var(--claude-border,rgba(128,128,128,.22))';
    prev.style.borderTop = '';
    prev.style.paddingLeft = '8px';
    prev.style.paddingTop = '';
    list.style.maxHeight = '';
  } else {
    body.style.flexDirection = 'column';
    prev.style.width = 'auto';
    prev.style.height = Math.round(h * 0.42) + 'px';
    prev.style.borderLeft = '';
    prev.style.borderTop = '1px solid var(--claude-border,rgba(128,128,128,.22))';
    prev.style.paddingLeft = '';
    prev.style.paddingTop = '6px';
    list.style.maxHeight = '';
  }
}

// ─────────────────────────────────────────────────────────────
//  PROJECT LABEL EMOJI
//  Puts the folder's emoji back on the sidebar groups that are named after a
//  git remote instead of after their folder.
// ─────────────────────────────────────────────────────────────
//
// Measured 2026-08-27 ([cc-dump] findLabels), after two wrong guesses about
// which container to look in. The app keys a sidebar project group two ways:
//
//   data-row-key="label:project-/home/z3z0/Documents/AI Projects/AI Projects Manager 🛠️"
//   data-row-key="label:project-behdadmansouri/connoisseurd"
//
// The first is a path and is labelled with the folder's basename, emoji and
// all. The second is `owner/repo` from the folder's git remote, and is labelled
// with the repo name - which no naming convention of ours touches. So the emoji
// was never lost or stripped: those five folders (the ones with a GitHub
// remote) stopped being named after their folder at all. Nothing in the DOM
// connects that row back to a path, which is why this needs a build-time map:
// update-ui.sh reads each folder's .git/config and bakes CC_AI_REPOS as
// {"owner/repo": "Folder Name 🎨"}.
//
// Deliberately additive: the repo name stays and the emoji is appended in a
// span of our own. Rewriting the label text would mean fighting React over a
// node it owns and would also throw away the one piece of information the row
// has that the folder name does not - which repo it actually is.
//
// localStorage['cc-repo-emoji'] = '0' turns it off.

const CC_REPOS = (typeof CC_AI_REPOS !== 'undefined') ? CC_AI_REPOS : {};
const LABEL_PREFIX = 'label:project-';
const REPO_EMOJI_KEY = 'cc-repo-emoji';

function repoEmojiOn() {
  try { return localStorage.getItem(REPO_EMOJI_KEY) !== '0'; } catch (_) { return true; }
}

function applyProjectLabels() {
  if (!repoEmojiOn()) return;
  for (const row of document.querySelectorAll('[data-row-key^="' + LABEL_PREFIX + '"]')) {
    const key = (row.getAttribute('data-row-key') || '').slice(LABEL_PREFIX.length);
    // A path-keyed group already carries the folder's own name. Only the
    // owner/repo form is missing one, and it is the form that never starts
    // with a separator.
    if (!key || key.charAt(0) === '/') continue;
    const folder = CC_REPOS[key];
    if (!folder) continue;
    const {emoji} = splitEmoji(folder);
    if (!emoji) continue;

    const span = row.querySelector('[data-sidebar-group-label] span.truncate') ||
                 row.querySelector('button span.truncate');
    if (!span || !span.parentElement) continue;
    // The label may already end in the emoji if the app ever starts naming
    // these after the folder again - in which case there is nothing to add.
    if ((span.textContent || '').indexOf(emoji) >= 0) continue;

    let tag = span.nextElementSibling;
    if (!tag || !tag.classList || !tag.classList.contains('cc-repo-emoji')) {
      tag = document.createElement('span');
      tag.className = 'cc-repo-emoji';
      // shrink-0 so it survives the truncation the sibling span is set up for:
      // the name is the thing allowed to be clipped, not the glyph.
      tag.style.cssText = 'flex:none;margin-left:4px;line-height:1;';
      span.insertAdjacentElement('afterend', tag);
    }
    // Re-checked rather than written blind on every scan: React re-renders this
    // row often, and an unconditional write would be a mutation that retriggers
    // the observer that called us.
    if (tag.textContent !== emoji) tag.textContent = emoji;
    if (tag.title !== folder) tag.title = folder;
  }
}

// ─────────────────────────────────────────────────────────────
//  USAGE READOUT
//  Live 5-hour / weekly plan usage + context window, in a fixed corner chip.
//
//  The old (2026-07, deleted) usage badges scraped the usage popover's text.
//  That could never be live: the numbers only exist in the DOM while the
//  popover is open, so the badge showed whatever it last happened to see, and
//  the attempt to fix that by auto-opening the popover on a timer is what broke
//  the effort picker (issues-fixed #13). This version does not read the DOM for
//  plan usage at all.
//
//  Source: the app's OWN endpoint.
//    GET /api/organizations/<org>/usage
//      → { five_hour:            {utilization, resets_at},
//          seven_day:            {...},   seven_day_opus:      {...},
//          seven_day_sonnet:     {...},   seven_day_oauth_apps:{...},
//          seven_day_cowork:     {...},   seven_day_omelette:  {...},
//          omelette_promotional: {...},
//          extra_usage: {is_enabled, monthly_limit, used_credits, utilization} }
//
//  Confirmed by reading the main-process bundle's tray-usage code (search
//  `[plan-usage]` in .vite/build/index.chunk-*.js): it hits exactly this URL
//  with `net.fetch` on the default session, on a 300s timer. The renderer
//  shares that session, so a same-origin credentialed fetch sees the same data.
//  `utilization` is 0-100. `resets_at` is an ISO timestamp - which is why
//  nothing on this path has to parse "Resets Wed 1:39 AM". That parsing was the
//  old badge's other failure mode; parseResetText() below survives only as a
//  fallback for the DOM-scraped context figure.
//
//  Debug from DevTools: window.__ccUsage()
// ─────────────────────────────────────────────────────────────

const CU_ORG_KEY   = 'cc-usage-org';     // cached organization uuid
const CU_SNAP_KEY  = 'cc-usage-snap';    // last payload, so a cold start shows something
const CU_POS_KEY   = 'cc-usage-corner';  // which corner the chip sits in
const CU_PROBE_KEY = 'cc-usage-probe';   // '1' = log candidate context payloads

const CU_POLL_MS   = 60000;   // steady-state refresh (the app itself uses 300s)
const CU_TICK_MS   = 20000;   // re-render cadence, so "resets in" counts down
const CU_STALE_MS  = 15 * 60000;

// The context figure is a snapshot of one conversation, scraped opportunistically
// from the popover. Unlike plan usage it does not stay true: it belongs to the
// chat it was read in, and it goes stale on its own as that chat grows. Past
// this age, and on any route change, it is treated as unknown and the chip drops
// the segment entirely rather than showing a number that is no longer about
// anything. Showing a wrong context percentage is worse than showing none - on a
// brand-new session it read as "you have already burned N% of this window".
const CU_CTX_TTL   = 8 * 60000;

// Floating (fallback) chip only: how long the pointer has to rest inside the
// chip before it starts accepting clicks. See cuArmWatch.
const CU_DWELL_MS  = 200;

const CU_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// [key, long label, short label]. Order is the order they appear in the card.
// Kept in sync with the bundle's own bucket list; unknown keys in the payload
// are ignored rather than guessed at, and buckets the account doesn't have
// come back null and are skipped.
const CU_BUCKETS = [
  ['five_hour',            '5-hour limit',           '5h'],
  ['seven_day',            'Weekly · all models',    'wk'],
  ['seven_day_opus',       'Weekly · Opus',          'opus'],
  ['seven_day_sonnet',     'Weekly · Sonnet',        'sonnet'],
  ['seven_day_oauth_apps', 'Weekly · Claude Code',   'code'],
  ['seven_day_cowork',     'Weekly · Cowork',        'cowork'],
  ['seven_day_omelette',   'Weekly · Claude Design', 'design'],
  ['omelette_promotional', 'Claude Design grant',    'grant'],
];

// The three the chip itself shows, left to right.
const CU_CHIP = ['ctx', 'five_hour', 'seven_day'];

let cuPlan     = null;   // last parsed /usage payload
let cuPlanAt   = 0;      // when we got it
let cuCtx      = null;   // {pct, used, total, at} - context window, DOM/network sourced
let cuOrg      = null;
let cuFailures = 0;
let cuTimer    = null;

// ── formatting ──────────────────────────────────────────────────────────────

// 4h12m / 45m / 2d 3h. Single-unit above a day would round "6d 23h" to "6d",
// which reads as a whole day of slack that isn't there.
function cuFmtIn(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return min + 'm';
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? h + 'h' + m + 'm' : h + 'h';
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? d + 'd ' + rh + 'h' : d + 'd';
}

function cuPct(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// Each bucket keeps its own hue so the chip can drop its text labels and still
// be readable at a glance, and severity overrides the hue once a number is
// actually worth reacting to. Colouring 30% orange just trains you to ignore
// the colour, so nothing warns below 60.
const CU_HUE = {ctx: '#3b82f6', five_hour: '#d97706', seven_day: '#16a34a'};
function cuColor(pct, key) {
  if (pct == null) return 'var(--cc-u-dim)';
  if (pct >= 95) return '#ef4444';
  if (pct >= 80) return '#f97316';
  if (pct >= 60) return '#eab308';
  return (key && CU_HUE[key]) || 'var(--cc-u-fg)';
}

// ── reset-time parsing (fallback only) ──────────────────────────────────────
//
// The API path never needs this - resets_at is ISO. It exists for text scraped
// out of the UI, where the wording has changed at least three times already
// ("Resets Wed 9:59 AM" → "Resets Jun 24" → "resets 59m"). Rather than chase
// each new spelling, try every shape the app and claude.ai have been observed
// to use, plus the obvious neighbours, and take the first that parses.
//
// Returns an absolute ms timestamp, or null.
const CU_DOW    = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const CU_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                   'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "3", "3:15", "3:15 pm", "15:15" → {h, m} in 24h, or null.
function cuClock(hStr, mStr, ampm) {
  let h = +hStr;
  const m = mStr ? +mStr : 0;
  if (!Number.isFinite(h) || h > 23 || m > 59) return null;
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  return {h, m};
}

// Next wall-clock occurrence of h:m, optionally on a named weekday.
function cuNextAt(h, m, dayHint, now) {
  const t = new Date(now);
  t.setHours(h, m, 0, 0);
  const d = (dayHint || '').toLowerCase();
  if (!d || d === 'today') {
    if (t.getTime() <= now) t.setDate(t.getDate() + 1);
  } else if (d === 'tomorrow' || d === 'tmrw') {
    t.setDate(t.getDate() + 1);
  } else {
    const want = CU_DOW.findIndex(x => d.startsWith(x));
    if (want === -1) return null;
    let ahead = want - t.getDay();
    if (ahead < 0 || (ahead === 0 && t.getTime() <= now)) ahead += 7;
    t.setDate(t.getDate() + ahead);
  }
  return t.getTime();
}

// "2d 4h 30m", "45 minutes", "3 hrs" → milliseconds.
function cuDuration(str) {
  const re = /(\d+(?:\.\d+)?)\s*(d(?:ays?)?|h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)\b/gi;
  let total = 0, m;
  while ((m = re.exec(str))) {
    const n = parseFloat(m[1]), u = m[2][0].toLowerCase();
    total += n * (u === 'd' ? 86400000 : u === 'h' ? 3600000 : u === 'm' ? 60000 : 1000);
  }
  return total || null;
}

function parseResetText(str, now) {
  if (!str || typeof str !== 'string') return null;
  now = now || Date.now();
  const s = str.replace(/ /g, ' ').trim();
  let m;

  // 1. ISO 8601 / RFC 3339, with or without zone. What the API returns.
  m = s.match(/\b(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?)\b/);
  if (m) {
    const t = Date.parse(m[1].replace(' ', 'T'));
    if (Number.isFinite(t)) return t;
  }

  // 2. Epoch seconds/millis, in case a payload ever exposes one raw.
  m = s.match(/\b(1[0-9]{9}(?:[0-9]{3})?)\b/);
  if (m) {
    const n = +m[1];
    return n > 1e12 ? n : n * 1000;
  }

  // 3. Relative: "resets in 2h 15m", "in 45 minutes", "· resets 59m", "1h".
  //    Anchored on "resets"/"in" so a stray "5-hour" can't be read as a delta.
  m = s.match(/(?:resets?|refreshes?|renews?|available|back)\b[^0-9]{0,12}((?:\d+(?:\.\d+)?\s*(?:d|h|m|s|days?|hours?|hrs?|min(?:ute)?s?|sec(?:ond)?s?)\s*)+)/i)
   || s.match(/\bin\s+((?:\d+(?:\.\d+)?\s*(?:d|h|m|s|days?|hours?|hrs?|min(?:ute)?s?|sec(?:ond)?s?)\s*)+)/i);
  if (m) {
    const d = cuDuration(m[1]);
    if (d) return now + d;
  }

  // 4. Weekday/today/tomorrow + clock: "Resets Wed 1:39 AM", "resets tomorrow at 3pm".
  m = s.match(/(?:resets?|until|at)\b\s*(?:on\s+)?(today|tomorrow|tmrw|sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i);
  if (m) {
    const c = cuClock(m[2], m[3], m[4]);
    if (c) {
      const t = cuNextAt(c.h, c.m, m[1], now);
      if (t) return t;
    }
  }

  // 5. Weekday alone: "Resets Wednesday".
  m = s.match(/resets?\s+(?:on\s+)?(today|tomorrow|tmrw|sun|mon|tue|wed|thu|fri|sat)[a-z]*\b(?!\s*\d)/i);
  if (m) {
    const t = cuNextAt(0, 0, m[1], now);
    if (t) return t;
  }

  // 6. Month + day (+ optional year/clock): "Resets Jun 24", "Resets June 24 at 9:00 AM".
  m = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?(?:\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (m) {
    const mon = CU_MONTHS.indexOf(m[1].toLowerCase());
    const c = m[4] ? cuClock(m[4], m[5], m[6]) : {h: 0, m: 0};
    if (mon >= 0 && c) {
      const t = new Date(now);
      t.setMonth(mon, +m[2]);
      t.setHours(c.h, c.m, 0, 0);
      if (m[3]) t.setFullYear(+m[3]);
      else if (t.getTime() < now - 86400000) t.setFullYear(t.getFullYear() + 1);
      return t.getTime();
    }
  }

  // 7. Numeric date: "resets 6/24", "resets 24/06/2026". Ambiguous by locale,
  //    so resolve it the way the page would: read it in the browser's own order.
  m = s.match(/resets?\s+(?:on\s+)?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?/i);
  if (m) {
    const a = +m[1], b = +m[2];
    // Day-first if the first number can't be a month, or if the locale is.
    const dayFirst = a > 12 || !/^en-?US?$/i.test(navigator.language || 'en-US');
    const day = dayFirst ? a : b, mon = (dayFirst ? b : a) - 1;
    if (mon >= 0 && mon < 12 && day >= 1 && day <= 31) {
      const t = new Date(now);
      t.setMonth(mon, day);
      t.setHours(0, 0, 0, 0);
      if (m[3]) t.setFullYear(+m[3] < 100 ? 2000 + +m[3] : +m[3]);
      else if (t.getTime() < now - 86400000) t.setFullYear(t.getFullYear() + 1);
      return t.getTime();
    }
  }

  // 8. Clock only: "Resets at 15:00", "resets at 3pm".
  m = s.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))\s*(am|pm)?|resets?\s+at\s+(\d{1,2})\s*(am|pm)/i);
  if (m) {
    const c = m[1] ? cuClock(m[1], m[2], m[3]) : cuClock(m[4], null, m[5]);
    if (c) return cuNextAt(c.h, c.m, null, now);
  }

  return null;
}

// ── org uuid ────────────────────────────────────────────────────────────────

// The main process reads this from the `lastActiveOrg` cookie. Try the same
// cookie first (it isn't HttpOnly in practice, but don't rely on that), then a
// cached value, then ask the API.
function cuCookieOrg() {
  try {
    for (const part of (document.cookie || '').split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() !== 'lastActiveOrg') continue;
      const m = decodeURIComponent(part.slice(eq + 1)).match(CU_UUID_RE);
      if (m) return m[0];
    }
  } catch (_) {}
  return null;
}

async function cuFetchJSON(path) {
  const r = await fetch(path, {
    credentials: 'include',
    headers: {accept: 'application/json'},
    cache: 'no-store',
  });
  if (!r.ok) {
    const e = new Error('HTTP ' + r.status);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

async function cuResolveOrg(force) {
  if (cuOrg && !force) return cuOrg;
  if (!force) {
    const cached = (() => { try { return localStorage.getItem(CU_ORG_KEY); } catch (_) { return null; } })();
    if (cached && CU_UUID_RE.test(cached)) { cuOrg = cached; return cuOrg; }
  }
  const fromCookie = cuCookieOrg();
  if (fromCookie) { cuOrg = fromCookie; }
  else {
    const orgs = await cuFetchJSON('/api/organizations');
    if (!Array.isArray(orgs) || !orgs.length) throw new Error('no organizations');
    // Prefer an org that can actually chat; some accounts carry API-only orgs.
    const pick = orgs.find(o => Array.isArray(o.capabilities) && o.capabilities.includes('chat')) || orgs[0];
    if (!pick || !CU_UUID_RE.test(pick.uuid || '')) throw new Error('no org uuid');
    cuOrg = pick.uuid;
  }
  try { localStorage.setItem(CU_ORG_KEY, cuOrg); } catch (_) {}
  return cuOrg;
}

// ── plan usage ──────────────────────────────────────────────────────────────

function cuStoreSnapshot() {
  try {
    localStorage.setItem(CU_SNAP_KEY, JSON.stringify({plan: cuPlan, at: cuPlanAt}));
  } catch (_) {}
}

function cuLoadSnapshot() {
  try {
    const d = JSON.parse(localStorage.getItem(CU_SNAP_KEY) || 'null');
    if (d && d.plan && typeof d.plan === 'object') { cuPlan = d.plan; cuPlanAt = d.at || 0; }
  } catch (_) {}
}

// Accepts a payload from either the poll or the fetch hook.
function cuAdoptPlan(data) {
  if (!data || typeof data !== 'object') return false;
  const known = CU_BUCKETS.some(([k]) => k in data);
  if (!known && !('extra_usage' in data)) return false;
  cuPlan = data;
  cuPlanAt = Date.now();
  cuFailures = 0;
  cuStoreSnapshot();
  cuRender();
  return true;
}

async function cuPoll() {
  if (document.hidden) return;
  try {
    const org = await cuResolveOrg(false);
    cuAdoptPlan(await cuFetchJSON('/api/organizations/' + org + '/usage'));
  } catch (e) {
    cuFailures++;
    // A stale cached org uuid (org switch, re-login) shows up as 401/403/404.
    // Drop it and let the next tick re-resolve from scratch, once.
    if (e && (e.status === 401 || e.status === 403 || e.status === 404)) {
      cuOrg = null;
      try { localStorage.removeItem(CU_ORG_KEY); } catch (_) {}
    }
    if (cuFailures === 1 || cuFailures % 10 === 0) {
      console.warn('[cc-usage] fetch failed (' + cuFailures + ')', e && e.message);
    }
    cuRender();
  }
}

function cuSchedule() {
  if (cuTimer) clearTimeout(cuTimer);
  // Back off on repeated failure so a logged-out window isn't hammering the
  // API every minute, but never past 10 minutes.
  const delay = Math.min(CU_POLL_MS * Math.max(1, Math.min(cuFailures, 10)), 600000);
  cuTimer = setTimeout(() => { cuPoll().finally(cuSchedule); }, delay);
}

// ── context window ──────────────────────────────────────────────────────────
//
// Unlike plan usage there is no endpoint for this: the context figure is
// computed client-side and only surfaces in the usage popover. So it is read
// from the DOM when it happens to be visible, and from any API payload that
// carries it (see cuNetProbe). It is deliberately NOT refreshed by opening the
// popover on a timer - that is what broke the effort picker last time.
function cuSetCtx(pct, used, total) {
  pct = cuPct(pct);
  if (pct == null && used != null && total) pct = cuPct(used / total * 100);
  if (pct == null) return;
  cuCtx = {pct, used: used ?? null, total: total ?? null, at: Date.now()};
  cuRender();
}

// "56.4k / 200.0k (28%)" and friends. Also plain "context 28%".
const CU_CTX_FRAC = /([\d.]+)\s*([km])?\s*\/\s*([\d.]+)\s*([km])?\s*(?:\((\d{1,3})%\))?/i;

function cuScale(n, suffix) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return null;
  const s = (suffix || '').toLowerCase();
  return s === 'm' ? v * 1e6 : s === 'k' ? v * 1e3 : v;
}

// Everything that starts a DIFFERENT reading in the same popover. The old scan
// sliced from the word "context" to the end of the overlay text and took the
// first percentage anywhere after it - so on a page where the popover has a
// "Context window" heading with no number of its own (a fresh session, nothing
// sent yet) the first % it found was the NEXT row's, i.e. the 5-hour limit. That
// is exactly the "context and 5-hour show the same number" symptom. Cutting the
// segment at the next label means a context row with no number reads as no
// number, which is the correct answer.
const CU_CTX_STOP = /5[-\s]?hour|weekly|per[-\s]week|opus|sonnet|haiku|resets?\b|extra usage|current plan|upgrade/i;

// A percentage/fraction that genuinely belongs to the context row, or null.
function cuCtxFromText(text) {
  const i = text.search(/context/i);
  if (i < 0) return null;
  let seg = text.slice(i, i + 160);
  // Drop the word "context" itself before looking for a stop word, so
  // "Context window" doesn't get cut on its own heading.
  const rest = seg.replace(/^context(\s+window)?/i, '');
  const stop = rest.search(CU_CTX_STOP);
  if (stop >= 0) seg = rest.slice(0, stop);
  else seg = rest;
  const f = seg.match(CU_CTX_FRAC);
  if (f) return {pct: f[5] ? +f[5] : null, used: cuScale(f[1], f[2]), total: cuScale(f[3], f[4])};
  const p = seg.match(/(\d{1,3})\s*%/);
  if (p) return {pct: +p[1], used: null, total: null};
  return null;
}

function cuScanContext() {
  // 1. Anything that labels itself. aria-label survived several redesigns as
  //    "Usage: context 28%, plan 7%" before context was dropped from it; if it
  //    ever comes back this picks it up for free.
  for (const el of document.querySelectorAll('[aria-label*="ontext" i]')) {
    const hit = cuCtxFromText(el.getAttribute('aria-label') || '');
    if (hit) { cuSetCtx(hit.pct, hit.used, hit.total); return true; }
  }

  // 2. The usage popover, while it is open. Scoped to open overlay containers
  //    rather than document.body.innerText - a whole-body innerText read forces
  //    layout on every call, which is exactly the kind of thing that made the
  //    renderer unresponsive before (issues-fixed #3).
  const overlays = document.querySelectorAll(
    '[role="dialog"],[role="tooltip"],[data-state="open"],[data-radix-popper-content-wrapper]');
  for (const o of overlays) {
    if (!o.offsetParent && o.getClientRects().length === 0) continue;
    const t = o.innerText || '';
    if (!/context/i.test(t)) continue;
    const hit = cuCtxFromText(t);
    if (hit) { cuSetCtx(hit.pct, hit.used, hit.total); return true; }
  }
  return false;
}

// ── network hook ────────────────────────────────────────────────────────────
//
// Two jobs, both cheap:
//   - adopt any /usage response the app fetches for itself, so the numbers move
//     the instant the app's own tray refresh lands rather than on our timer;
//   - notice when a completion finishes and re-poll shortly after, since that
//     is the only moment usage actually changes.
// Response bodies are only read for URLs we already expect to be usage JSON.
// Everything else is a URL check and nothing more.
let cuBurst = null;
function cuBurstPoll() {
  if (cuBurst) return;
  // Usage is recomputed server-side a beat after the turn ends; one poll at 5s
  // and one at 25s covers it without turning every message into a poll storm.
  cuBurst = setTimeout(() => {
    cuBurst = null;
    cuPoll();
    setTimeout(cuPoll, 20000);
  }, 5000);
}

function cuProbeLog(url, body) {
  try {
    if (localStorage.getItem(CU_PROBE_KEY) !== '1') return;
    const keys = body && typeof body === 'object' ? Object.keys(body).slice(0, 40) : [];
    console.log('[cc-usage-probe]', url, keys);
  } catch (_) {}
}

function cuNetHook() {
  const orig = window.fetch;
  if (typeof orig !== 'function' || orig.__ccUsageHooked) return;
  const hooked = function (input, init) {
    const p = orig.apply(this, arguments);
    let url = '';
    try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (_) {}
    if (!url) return p;
    if (/\/usage(\?|$)/.test(url)) {
      p.then(res => {
        if (!res || !res.ok) return;
        res.clone().json().then(d => { cuProbeLog(url, d); cuAdoptPlan(d); }).catch(() => {});
      }).catch(() => {});
    } else if (/\/completion|\/retry_completion/.test(url)) {
      p.then(() => cuBurstPoll()).catch(() => {});
    }
    return p;
  };
  hooked.__ccUsageHooked = true;
  try { window.fetch = hooked; } catch (_) {}
}

// ── chip ────────────────────────────────────────────────────────────────────

const CU_CORNERS = ['br', 'bl', 'tr', 'tl'];

function cuCorner() {
  try {
    const v = localStorage.getItem(CU_POS_KEY);
    if (CU_CORNERS.includes(v)) return v;
  } catch (_) {}
  return 'br';
}

function cuInjectCSS() {
  if (document.getElementById('cc-usage-css')) return;
  const s = document.createElement('style');
  s.id = 'cc-usage-css';
  s.textContent = [
    ':root{--cc-u-bg:#f2e8d5;--cc-u-fg:#2b2418;--cc-u-dim:rgba(43,36,24,.42);--cc-u-line:rgba(0,0,0,.16);}',
    '@media (prefers-color-scheme:dark){:root{--cc-u-bg:#2e2919;--cc-u-fg:#ece5d5;--cc-u-dim:rgba(236,229,213,.42);--cc-u-line:rgba(255,255,255,.14);}}',
    // The wrapper spans the corner but must never eat clicks meant for the app;
    // only the chip itself is interactive.
    //
    // -webkit-app-region:no-drag is the whole reason the top corners work at
    // all. Electron marks the window's top strip as a drag region, and a drag
    // region swallows pointer events before they reach anything painted inside
    // it - which is why the chip went dead the moment it moved up there, and
    // why the app's own top-bar icons are awkward to hit. Opting this element
    // out puts clicks back.
    '#cc-usage{position:fixed;z-index:2147483000;pointer-events:none;font-family:inherit;' +
      'font-variant-numeric:tabular-nums;letter-spacing:-.01em;-webkit-app-region:no-drag;}',
    '#cc-usage[data-corner="br"]{right:12px;bottom:12px;}',
    '#cc-usage[data-corner="bl"]{left:12px;bottom:12px;}',
    // Top corners clear the app's own 44px top bar rather than sitting under it.
    '#cc-usage[data-corner="tr"]{right:12px;top:46px;}',
    '#cc-usage[data-corner="tl"]{left:12px;top:46px;}',
    // Floating mode is an overlay painted over the app's own UI, so its default
    // is click-THROUGH. It used to be pointer-events:auto unconditionally, which
    // meant the ~120x20px rectangle it happens to occupy swallowed hover and
    // clicks meant for whatever was underneath - on the home tab that is a
    // session row in the sidebar, whose archive control became unreachable.
    // cuArmWatch adds .cc-armed once the pointer has actually RESTED on the chip,
    // so passing over it costs nothing and parking on it still works.
    '#cc-usage[data-float="1"] .cc-u-chip{pointer-events:none;}',
    '#cc-usage[data-float="1"].cc-armed .cc-u-chip{pointer-events:auto;}',
    '#cc-usage.cc-armed .cc-u-chip{opacity:1;}',
    '#cc-usage.cc-armed .cc-u-card{display:block;}',
    '.cc-u-chip{pointer-events:auto;-webkit-app-region:no-drag;' +
      'display:inline-flex;align-items:center;gap:7px;' +
      'background:var(--cc-u-bg);color:var(--cc-u-fg);border:1px solid var(--cc-u-line);' +
      'border-radius:7px;padding:3px 8px;font-size:10.5px;line-height:1.5;cursor:pointer;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.14);opacity:.6;transition:opacity .12s;user-select:none;}',
    '#cc-usage:hover .cc-u-chip{opacity:1;}',
    // Attached mode: inline inside the app's own composer footer, no card of
    // its own, inheriting the row's sizing.
    '.cc-u-chip.attached{background:transparent;border:0;box-shadow:none;opacity:.9;padding:0 4px;}',
    '.cc-u-chip .v{font-weight:700;}',
    '.cc-u-chip .r{opacity:.45;font-size:9.5px;}',
    '.cc-u-chip .sep{opacity:.25;}',
    '.cc-u-card{pointer-events:none;display:none;position:absolute;min-width:230px;' +
      'background:var(--cc-u-bg);color:var(--cc-u-fg);border:1px solid var(--cc-u-line);' +
      'border-radius:8px;padding:8px 10px;font-size:11px;line-height:1.5;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.22);}',
    '#cc-usage:hover .cc-u-card{display:block;}',
    '#cc-usage[data-corner="br"] .cc-u-card,#cc-usage[data-corner="bl"] .cc-u-card{bottom:calc(100% + 6px);}',
    '#cc-usage[data-corner="tr"] .cc-u-card,#cc-usage[data-corner="tl"] .cc-u-card{top:calc(100% + 6px);}',
    '#cc-usage[data-corner="br"] .cc-u-card,#cc-usage[data-corner="tr"] .cc-u-card{right:0;}',
    '#cc-usage[data-corner="bl"] .cc-u-card,#cc-usage[data-corner="tl"] .cc-u-card{left:0;}',
    '.cc-u-row{display:flex;align-items:baseline;gap:8px;}',
    '.cc-u-row .l{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.8;}',
    '.cc-u-bar{height:3px;border-radius:2px;background:var(--cc-u-line);margin:1px 0 4px;overflow:hidden;}',
    '.cc-u-bar>i{display:block;height:100%;border-radius:2px;}',
    '.cc-u-foot{margin-top:5px;padding-top:4px;border-top:1px solid var(--cc-u-line);' +
      'font-size:9.5px;opacity:.5;}',
  ].join('\n');
  document.head.appendChild(s);
}

let cuRoot = null, cuChipEl = null, cuCardEl = null, cuNative = null;
// The button whose icon we collapsed, so it can be put back if the match moves.
let cuCollapsed = null;

function cuUncollapse(el) {
  if (!el) return;
  for (const svg of el.querySelectorAll(':scope > svg, :scope > span > svg')) {
    svg.style.display = '';
  }
  el.style.width = '';
  el.style.padding = '';
  el.style.overflow = '';
  if (cuCollapsed === el) cuCollapsed = null;
}

// The app's own usage control - the little circular tracker next to the model
// name in the composer footer. Found by aria-label, never by class name or
// position, and guarded to icon-button dimensions so a redesign that reuses the
// word "usage" on a big container can't get its icon hidden (issues-fixed #18).
//
// The label test is a WORD match, not a substring one (issues-fixed #46).
// `[aria-label*="plan" i]` also matched "More options for Fable project
// critique and planning" - the 20x20 overflow button on a session row, which
// passed every geometric guard, so the chip was inserted into that row and
// painted across the session title. A substring of a word is not a match.
//
// And matching is not enough on its own: several buttons can pass, so they are
// scored and the best one wins rather than the first one in document order.
const CU_NATIVE_RE =
  /\busage\b|\b(?:usage|plan|rate|weekly|5-?hour|context)\s+limits?\b|\bplan\s+usage\b/i;
// Anything that announces itself as a control FOR something else is not it.
const CU_NATIVE_NOT_RE = /more options|options for|menu for|settings for/i;

function cuFindNative() {
  if (cuNative && cuNative.isConnected) return cuNative;
  cuNative = null;
  // Cheap attribute prefilter, then the real (word-boundary) test.
  const cands = document.querySelectorAll(
    'button[aria-label*="usage" i],button[aria-label*="limit" i],' +
    'button[aria-label*="plan" i]');
  let best = null, bestScore = -1;
  for (const b of cands) {
    const label = b.getAttribute('aria-label') || '';
    if (!CU_NATIVE_RE.test(label) || CU_NATIVE_NOT_RE.test(label)) continue;
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.width > 90 || r.height > 60) continue;
    // A control inside a list row belongs to that row, whatever it is called.
    if (b.closest('[role="listitem"],[role="row"],[role="option"],li,a[href]')) continue;
    // The real one leads with "Usage", carries live percentages, and sits in
    // the composer footer at the bottom of the window.
    const score = (/^usage\b/i.test(label) ? 2 : 0) + (/%|\bcontext\b/i.test(label) ? 2 : 0) +
      (r.top > window.innerHeight * 0.5 ? 1 : 0);
    if (score > bestScore) { best = b; bestScore = score; }
  }
  cuNative = best;
  return cuNative;
}

function cuCycleCorner() {
  const next = CU_CORNERS[(CU_CORNERS.indexOf(cuRoot.dataset.corner) + 1) % CU_CORNERS.length];
  cuRoot.dataset.corner = next;
  cuInvalidateRect();
  try { localStorage.setItem(CU_POS_KEY, next); } catch (_) {}
}

// Sit inside the composer footer next to the app's own control when we can find
// it, and fall back to a floating corner chip when we can't. Re-checked on the
// tick because React remounts that footer.
function cuPlace() {
  const native = cuFindNative();
  if (native && native.parentElement) {
    if (cuRoot.parentElement !== native.parentElement || cuRoot.nextSibling !== native) {
      native.parentElement.insertBefore(cuRoot, native);
    }
    cuRoot.style.position = 'static';
    cuRoot.style.pointerEvents = 'auto';
    cuRoot.dataset.float = '0';
    cuRoot.classList.remove('cc-armed');
    cuChipEl.classList.add('attached');
    // Collapse only the icon, never the button: the button stays in the DOM and
    // stays clickable, which is what keeps the native popover reachable.
    //
    // Whatever was collapsed last is restored first. Before #46 the match could
    // land on an unrelated row control, and a mis-collapsed button stayed
    // 0px wide until React happened to remount it.
    if (cuCollapsed && cuCollapsed !== native) cuUncollapse(cuCollapsed);
    for (const svg of native.querySelectorAll(':scope > svg, :scope > span > svg')) {
      svg.style.display = 'none';
    }
    native.style.width = '0px';
    native.style.padding = '0px';
    native.style.overflow = 'hidden';
    cuCollapsed = native;
    return true;
  }
  if (cuCollapsed) cuUncollapse(cuCollapsed);
  if (cuRoot.parentElement !== document.body) document.body.appendChild(cuRoot);
  cuRoot.style.position = '';
  cuRoot.style.pointerEvents = '';
  cuRoot.dataset.float = '1';
  cuChipEl.classList.remove('attached');
  cuAvoidSidebar();
  return false;
}

// The floating chip lives in a viewport corner, and on the home tab the left
// corners are the session list - which is how it ended up painted across a
// Cowork session row. Being click-through (see cuArmWatch) made that harmless
// but not less odd to look at.
//
// So: find where the sidebar ends and push a left-corner chip past it. The
// sidebar is identified geometrically - a tall element pinned to the left edge,
// narrower than half the window - rather than by any class name, because class
// names here are generated and change between releases.
// Restricting the scan to nav/aside/[class*=sidebar] was the flaw: the Code
// tab's session list is none of those, so this returned 0 there and the chip
// parked in the bare left corner - on top of a project row. Which is exactly
// the "it's sitting on one of my projects" report, in the one tab the original
// selector list happened not to cover.
//
// Geometry is the only thing all three tabs' left panes have in common, so
// scan by geometry alone: any element pinned to the left edge, tall, and
// narrower than half the window. Everything is a candidate, but the test is
// strict enough that only a real left pane passes.
//
// Two guards keep the sweep honest. Depth-capping at 12 skips the deep leaf
// nodes, which can't be a pane and would dominate the element count. And a
// candidate must not be a near-full-height ANCESTOR of the whole app - the
// page's own layout wrappers are also pinned to the left edge, and one of them
// spanning half the window would push the chip into the middle of the screen.
function cuSidebarRight() {
  let best = 0;
  const vw = window.innerWidth, vh = window.innerHeight;
  const walk = (el, depth) => {
    if (depth > 12) return;
    for (const kid of el.children) {
      const r = kid.getBoundingClientRect();
      const wide = r.width > vw * 0.5;
      // A left-pinned, tall, narrow box: a pane. Record it, and don't descend -
      // its own children are pane CONTENTS, not further panes.
      if (r.left <= 4 && r.width >= 80 && !wide && r.height >= vh * 0.5) {
        if (r.right > best) best = r.right;
        continue;
      }
      // Too wide to be a pane, but it may CONTAIN one.
      if (wide || r.width === 0) walk(kid, depth + 1);
    }
  };
  walk(document.body, 0);
  return best;
}

function cuAvoidSidebar() {
  const corner = cuRoot.dataset.corner || 'br';
  if (corner !== 'bl' && corner !== 'tl') { cuRoot.style.left = ''; return; }
  const right = cuSidebarRight();
  cuRoot.style.left = right > 0 ? Math.round(right + 12) + 'px' : '';
  cuInvalidateRect();
}

// Dwell-to-arm for the floating chip. The chip is click-through until the
// pointer has been inside it continuously for CU_DWELL_MS, at which point it
// becomes interactive and shows its card; leaving disarms it immediately.
//
// The rect is read on the mousemove that first lands in the cached box (and
// whenever the cache is invalidated), not on every move - a listener that
// measured on each event would force layout thousands of times a minute.
let cuArmTimer = null, cuRect = null, cuRectAt = 0;
function cuInvalidateRect() { cuRect = null; }
function cuChipRect() {
  if (cuRect && Date.now() - cuRectAt < 1000) return cuRect;
  cuRect = cuChipEl.getBoundingClientRect();
  cuRectAt = Date.now();
  return cuRect;
}
function cuDisarm() {
  if (cuArmTimer) { clearTimeout(cuArmTimer); cuArmTimer = null; }
  cuRoot.classList.remove('cc-armed');
}
function cuArmWatch() {
  document.addEventListener('mousemove', e => {
    if (!cuRoot || !cuRoot.isConnected || cuRoot.dataset.float !== '1') return;
    const r = cuChipRect();
    // A couple of pixels of slack so a hand that shakes on the border doesn't
    // flicker the card in and out.
    const inside = e.clientX >= r.left - 2 && e.clientX <= r.right + 2 &&
                   e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2;
    if (inside) {
      if (cuArmTimer || cuRoot.classList.contains('cc-armed')) return;
      cuArmTimer = setTimeout(() => {
        cuArmTimer = null;
        cuRoot.classList.add('cc-armed');
      }, CU_DWELL_MS);
    } else {
      cuDisarm();
    }
  }, {passive: true, capture: true});
  window.addEventListener('resize', cuInvalidateRect);
  window.addEventListener('scroll', cuInvalidateRect, {passive: true, capture: true});
}

// Clearing the context reading the moment the route changes, rather than up to
// one tick later. The app is a SPA, so navigation is a pushState call, not a
// load event. Wrapping the two history methods is the only way to see it
// immediately; both wrappers are transparent (return value passed through).
function cuRouteWatch() {
  const drop = () => { cuCtx = null; cuRender(); };
  for (const name of ['pushState', 'replaceState']) {
    const orig = history[name];
    if (typeof orig !== 'function' || orig.__ccUsageHooked) continue;
    const wrapped = function () {
      const r = orig.apply(this, arguments);
      try { drop(); } catch (_) {}
      return r;
    };
    wrapped.__ccUsageHooked = true;
    try { history[name] = wrapped; } catch (_) {}
  }
  window.addEventListener('popstate', drop);
}

function cuInstall() {
  if (cuRoot && cuRoot.isConnected) return;
  cuInjectCSS();
  cuRoot = document.createElement('div');
  cuRoot.id = 'cc-usage';
  cuRoot.dataset.corner = cuCorner();
  cuChipEl = document.createElement('div');
  cuChipEl.className = 'cc-u-chip';
  cuChipEl.title = 'Claude usage - click for the full breakdown, right-click to move it';
  // Clicking opens the app's own usage popover rather than doing something
  // custom. That also happens to be the only thing that puts the context-window
  // figure into the DOM, so it doubles as a manual refresh for `ctx`.
  cuChipEl.onclick = e => {
    e.stopPropagation();
    const native = cuFindNative();
    if (native) {
      native.style.width = '';
      native.style.padding = '';
      fireClick(native);
      setTimeout(() => { try { cuScanContext(); cuRender(); } catch (_) {} }, 260);
      setTimeout(() => { try { cuScanContext(); cuRender(); cuPlace(); } catch (_) {} }, 900);
    } else {
      cuCycleCorner();
    }
  };
  cuChipEl.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); cuCycleCorner(); };
  cuCardEl = document.createElement('div');
  cuCardEl.className = 'cc-u-card';
  cuRoot.appendChild(cuChipEl);
  cuRoot.appendChild(cuCardEl);
  document.body.appendChild(cuRoot);
  cuPlace();
}

// True when the context reading is old enough that it is no longer about the
// conversation currently on screen.
function cuCtxStale() {
  return !cuCtx || (Date.now() - cuCtx.at) > CU_CTX_TTL;
}

function cuBucket(key) {
  if (key === 'ctx') {
    return cuCtxStale() ? null : {pct: cuCtx.pct, resetMs: null};
  }
  const b = cuPlan && cuPlan[key];
  if (!b || b.utilization == null) return null;
  const t = b.resets_at ? Date.parse(b.resets_at) : NaN;
  return {pct: cuPct(b.utilization), resetMs: Number.isFinite(t) ? t : null};
}

// No text label: the hue identifies the bucket (blue context, amber 5-hour,
// green weekly) and the hover card spells all of it out anyway. The labels were
// most of the chip's width and none of its information.
function cuItem(key, label, pct, resetMs) {
  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-flex;gap:3px;align-items:baseline;';
  wrap.title = label + (pct == null ? ': unknown' : ': ' + pct + '%');
  const v = document.createElement('span');
  v.className = 'v';
  v.textContent = pct == null ? '--' : pct + '%';
  v.style.color = cuColor(pct, key);
  wrap.appendChild(v);
  const left = resetMs == null ? null : cuFmtIn(resetMs - Date.now());
  if (left) {
    const r = document.createElement('span');
    r.className = 'r';
    r.textContent = left;
    wrap.appendChild(r);
  }
  return wrap;
}

function cuRender() {
  if (!cuRoot || !cuRoot.isConnected) return;

  cuChipEl.textContent = '';
  // An unknown CONTEXT reading is dropped from the chip outright rather than
  // rendered as "--". The plan buckets keep their placeholder - those are always
  // supposed to have a value, so "--" there means "fetch is failing", which is
  // worth seeing. Context legitimately has no value on a page that isn't a
  // conversation, and a placeholder in that slot just invites reading the number
  // next to it as the context one.
  let shown = 0;
  for (const key of CU_CHIP) {
    const b = cuBucket(key);
    if (key === 'ctx' && !b) continue;
    const label = key === 'ctx' ? 'Context window'
      : (CU_BUCKETS.find(x => x[0] === key) || [, key])[1];
    if (shown++) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '·';
      cuChipEl.appendChild(sep);
    }
    cuChipEl.appendChild(cuItem(key, label, b ? b.pct : null, b ? b.resetMs : null));
  }

  cuCardEl.textContent = '';
  const addRow = (label, pct, resetMs, extra) => {
    const row = document.createElement('div');
    row.className = 'cc-u-row';
    const l = document.createElement('span');
    l.className = 'l';
    l.textContent = label;
    const v = document.createElement('span');
    v.style.cssText = 'font-weight:700;color:' + cuColor(pct);
    v.textContent = pct == null ? '--' : pct + '%';
    row.appendChild(l);
    row.appendChild(v);
    const left = resetMs == null ? null : cuFmtIn(resetMs - Date.now());
    if (left || extra) {
      const r = document.createElement('span');
      r.style.cssText = 'opacity:.5;min-width:44px;text-align:right;';
      r.textContent = extra || left;
      row.appendChild(r);
    }
    cuCardEl.appendChild(row);
    const bar = document.createElement('div');
    bar.className = 'cc-u-bar';
    const fill = document.createElement('i');
    fill.style.width = (pct == null ? 0 : pct) + '%';
    fill.style.background = cuColor(pct);
    bar.appendChild(fill);
    cuCardEl.appendChild(bar);
  };

  if (!cuCtxStale()) {
    const detail = cuCtx.total
      ? Math.round(cuCtx.used / 1000) + 'k/' + Math.round(cuCtx.total / 1000) + 'k'
      : null;
    addRow('Context window', cuCtx.pct, null, detail);
  } else {
    addRow('Context window', null, null, cuCtx ? 'stale' : 'n/a');
  }

  let any = false;
  for (const [key, label] of CU_BUCKETS) {
    const b = cuBucket(key);
    if (!b) continue;
    any = true;
    addRow(label, b.pct, b.resetMs);
  }

  const ex = cuPlan && cuPlan.extra_usage;
  if (ex && ex.is_enabled) {
    const detail = ex.monthly_limit != null
      ? (ex.used_credits ?? 0) + '/' + ex.monthly_limit : null;
    addRow('Extra usage', cuPct(ex.utilization), null, detail);
  }

  const foot = document.createElement('div');
  foot.className = 'cc-u-foot';
  if (!cuPlanAt) {
    foot.textContent = cuFailures ? 'no usage data (' + cuFailures + ' failed fetches)' : 'loading…';
  } else {
    const age = Date.now() - cuPlanAt;
    foot.textContent = 'updated ' + (age < 60000 ? 'just now' : cuFmtIn(age) + ' ago') +
      (age > CU_STALE_MS ? ' · stale' : '') +
      (any ? '' : ' · no plan buckets');
  }
  cuCardEl.appendChild(foot);
}

// ── bootstrap ───────────────────────────────────────────────────────────────

let cuStarted = false;
function installUsage() {
  if (cuStarted) return;
  cuStarted = true;
  cuLoadSnapshot();
  cuNetHook();
  cuInstall();
  cuArmWatch();
  cuRouteWatch();
  cuRender();
  cuPoll().finally(cuSchedule);

  // Re-render (not re-fetch) so "resets in" counts down, and re-scan for the
  // context figure in case a popover opened since the last tick.
  //
  // The path check is what stops a reading taken in one conversation from being
  // presented as the next one's. There is no event for "the user opened a
  // different chat" that we can rely on, but the pathname changing is a fact,
  // and every route change means the previous context number is about a page
  // that is no longer on screen.
  let cuPath = location.pathname;
  setInterval(() => {
    if (document.hidden) return;
    if (location.pathname !== cuPath) { cuPath = location.pathname; cuCtx = null; }
    if (!cuRoot || !cuRoot.isConnected) cuInstall();
    try { cuPlace(); } catch (_) {}
    try { cuScanContext(); } catch (_) {}
    cuInvalidateRect();
    cuRender();
  }, CU_TICK_MS);

  // Coming back to the window is the one moment a stale number is most visible.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cuPoll(); });
  window.addEventListener('focus', () => {
    if (Date.now() - cuPlanAt > 30000) cuPoll();
  });

  window.__ccUsage = function () {
    return {
      org: cuOrg, plan: cuPlan, planAgeMs: cuPlanAt ? Date.now() - cuPlanAt : null,
      ctx: cuCtx, ctxStale: cuCtxStale(),
      failures: cuFailures, corner: cuRoot && cuRoot.dataset.corner,
      floating: cuRoot && cuRoot.dataset.float === '1',
      armed: cuRoot && cuRoot.classList.contains('cc-armed'),
      attachedTo: cuNative ? (cuNative.getAttribute('aria-label') || cuNative.tagName) : null,
      refresh: () => cuPoll(),
      probe: on => { try { localStorage.setItem(CU_PROBE_KEY, on ? '1' : '0'); } catch (_) {} },
      parseResetText,
    };
  };
}

// ── "approaching your weekly limit" nag ─────────────────────────────────────
//
// Dismissed rather than hidden where possible: clicking the app's own close
// control makes the app remember, so it stays gone instead of being re-rendered
// and re-hidden forever. Hiding is the fallback.
//
// Every guard here exists because of issues-fixed #18, where a hider matched a
// container that had grown to wrap the whole app and blanked the page: this
// only ever touches a box that is small, is not the app root, and does not
// contain the composer.
const CU_NAG_KEY = 'cc-hide-limit-nag';
const CU_NAG_RE = /approaching\s+(?:your\s+)?(?:weekly|usage|5-hour)\s+limit|you(?:'|’)?re\s+approaching|approaching\s+the\s+limit/i;
const _cuSeenNags = new WeakSet();

function dismissLimitNags() {
  try { if (localStorage.getItem(CU_NAG_KEY) === '0') return; } catch (_) {}
  const scope = document.querySelectorAll(
    '[role="dialog"],[role="alertdialog"],[role="alert"],[role="status"],' +
    '[data-state="open"],[data-radix-popper-content-wrapper]');
  for (const el of scope) {
    if (_cuSeenNags.has(el)) continue;
    const r = el.getBoundingClientRect();
    // Toast-or-banner sized only. A full-screen overlay is not this.
    if (r.height === 0 || r.height > 320 || r.width > 760) continue;
    if (el === document.body || el === document.documentElement) continue;
    if (el.querySelector('textarea,[contenteditable="true"],form')) continue;
    const text = el.innerText || '';
    if (!CU_NAG_RE.test(text)) continue;
    _cuSeenNags.add(el);
    const close = [...el.querySelectorAll('button')].find(b => {
      const lbl = (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '');
      return /close|dismiss|got it|okay|ok\b|not now/i.test(lbl);
    });
    if (close) {
      console.log('[cc-usage] dismissing limit nag via its own close button');
      fireClick(close);
    } else {
      console.log('[cc-usage] hiding limit nag (no close button found)');
      el.style.display = 'none';
    }
  }
}

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

// ─────────────────────────────────────────────────────────────
//  TITLE WATCH
//  Claude Desktop reports a constant window caption of "Claude", so every
//  ActivityWatch event looks identical - "Claude → Claude" tells you nothing
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
//  When they all miss it leaves the title alone - a stale title is a much
//  smaller problem than a blank one.
//
//  Debug from DevTools: window.__ccTitleDebug()
// ─────────────────────────────────────────────────────────────

const TW_DEFAULT = 'Claude';
const TW_MAX_LEN = 90;

// Titles that carry no information - never worth overriding the default with.
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

// 2. The topbar row workspace.js already keys off - the chat/project name sits
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
  // ...and set the NATIVE window title too.
  //
  // document.title alone was never enough, which took a while to notice because
  // it looks like it should be: Electron normally mirrors the page title onto
  // the BrowserWindow. Something in this app suppresses that - every event in
  // ActivityWatch's window bucket read {"app":"Claude","title":"Claude"} the
  // whole time this module has been running. `ccBridge.setTitle` goes straight
  // to `win.setTitle()` in the main process, which nothing overrides, and that
  // is what a window-title watcher can actually see.
  try {
    if (window.ccBridge && window.ccBridge.setTitle) window.ccBridge.setTitle(title);
  } catch (_) {}
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
  try { applyTopbar(); } catch (_) {}
  // Cheap and idempotent: it only writes when a label is missing its glyph, so
  // riding the existing scan costs nothing and needs no second observer.
  try { applyProjectLabels(); } catch (_) {}

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
  try { installChrome(); } catch (e) { console.error('[cc-chrome] install failed', e); }
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

})();
