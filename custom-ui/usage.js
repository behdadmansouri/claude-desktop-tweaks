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

// The app's own usage control - the little circular tracker next to the model
// name in the composer footer. Found by aria-label, never by class name or
// position, and guarded to icon-button dimensions so a redesign that reuses the
// word "usage" on a big container can't get its icon hidden (issues-fixed #18).
function cuFindNative() {
  if (cuNative && cuNative.isConnected) return cuNative;
  cuNative = null;
  const cands = document.querySelectorAll(
    'button[aria-label*="usage" i],button[aria-label*="Usage" i],' +
    'button[aria-label*="limit" i],button[aria-label*="plan" i]');
  for (const b of cands) {
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.width > 90 || r.height > 60) continue;
    cuNative = b;
    break;
  }
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
    for (const svg of native.querySelectorAll(':scope > svg, :scope > span > svg')) {
      svg.style.display = 'none';
    }
    native.style.width = '0px';
    native.style.padding = '0px';
    native.style.overflow = 'hidden';
    return true;
  }
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
