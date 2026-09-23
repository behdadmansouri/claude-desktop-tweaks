// ─────────────────────────────────────────────────────────────
//  OVERVIEW: what 30+ projects need from a panel that used to be an alphabetical grid.
//
//  Four things, all derived from files that already exist (no per-project upkeep):
//    lanes   - Active / Waiting on you / Parked / Dormant, each sorted by recency
//    live    - a dot on projects with a Claude session writing right now
//    inbox   - every open item that is waiting on YOU, across every project and host
//    remote  - the same projects, scanned over ssh from every configured host
//
//  Data arrives over two IPCs (cc-activity-v1, cc-scan-remote-v1 in update-ui.sh).
//  Everything here is read-only; nothing in this file writes to a project.
// ─────────────────────────────────────────────────────────────
const DAY_MS       = 86400000;
const ACTIVE_DAYS  = 7;
const PARKED_DAYS  = 60;
const LIVE_MS      = 3 * 60 * 1000;      // a transcript written this recently = live
const REMOTE_TTL   = 5 * 60 * 1000;      // rescan a healthy host this often
const REMOTE_RETRY = 60 * 1000;          // ...and a failing one this often
const ACTIVITY_MS  = 30 * 1000;

const INBOX_KEY    = 'cc-ws-inbox';
const DORMANT_KEY  = 'cc-ws-dormant-open';
const INBOX_SKIP   = 'cc-ws-inbox-hosts';   // {host: true|false} overrides the root-only default

const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const inboxOn      = () => lsGet(INBOX_KEY) === '1';
const setInboxOn   = v => lsSet(INBOX_KEY, v ? '1' : '0');
const dormantOpen  = () => lsGet(DORMANT_KEY) === '1';

// ── lanes ───────────────────────────────────────────────────────────────────
//
// Exclusive, first match wins. "Waiting on you" only catches projects that are
// NOT recently active: a project you touched yesterday with a stale 🧍 line is
// Active, but one that has gone quiet with your name on an open item is exactly
// the one that is stuck on you, so it gets its own lane instead of decaying
// silently into Parked.
const LANES = [
  {key: 'active',  label: 'Active',         tip: 'Commit or session in the last ' + ACTIVE_DAYS + ' days'},
  {key: 'waiting', label: 'Waiting on you', tip: 'Quiet, with an open item that is yours (🧍 or Needs your call)'},
  {key: 'parked',  label: 'Parked',         tip: 'Quiet for up to ' + PARKED_DAYS + ' days'},
  {key: 'dormant', label: 'Dormant',        tip: 'Nothing for over ' + PARKED_DAYS + ' days (click to show)'},
];

function laneOf(ts, waiting, now) {
  if (ts && now - ts <= ACTIVE_DAYS * DAY_MS) return 'active';
  if (waiting) return 'waiting';
  if (ts && now - ts <= PARKED_DAYS * DAY_MS) return 'parked';
  return 'dormant';
}

function ageLabel(ts, now = Date.now()) {
  if (!ts) return 'never';
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 2) return 'just now';
  if (m < 90) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 36) return h + 'h ago';
  const d = Math.round(h / 24);
  if (d < 60) return d + 'd ago';
  return Math.round(d / 30) + 'mo ago';
}

// ── the inbox parser ────────────────────────────────────────────────────────
//
// Literal on purpose (same reasoning as the open-box counter): an unticked box
// that is either marked 🧍 or sits under a "Needs your call" heading. Anything
// looser starts listing the agent's own work as yours.
//   call  - under a Needs-your-call / 🤔 heading
//   you   - a 🧍 item anywhere else
//   check - a 🧍 item under Verification (a standing check, ranked last)
const ITEM_RE = /^[ \t]*[-*+][ \t]+\[[ \t]\][ \t]+(.*)$/;
const HEAD_RE = /^#{1,6}[ \t]+(.*)$/;

function cleanItem(s) {
  // Size and model tags (`S`, `M`, `L`, `think`) are for whoever does the work.
  return s.replace(/`(?:S|M|L|think)`[ \t]*/g, '').replace(/🧍|🤖|🤔/g, '').replace(/\*\*/g, '').replace(/`/g, '')
    .replace(/\s+/g, ' ').replace(/ ([:,.])/g, '$1').trim().slice(0, 140);
}

function parseInbox(text) {
  const out = [];
  if (typeof text !== 'string' || !text) return out;
  let heading = '';
  for (const line of text.split('\n')) {
    const h = line.match(HEAD_RE);
    if (h) { heading = h[1]; continue; }
    const m = line.match(ITEM_RE);
    if (!m) continue;
    const call = /needs your call|🤔/i.test(heading);
    if (!call && !m[1].includes('🧍')) continue;
    const kind = call ? 'call' : /verification/i.test(heading) ? 'check' : 'you';
    out.push({kind, text: cleanItem(m[1])});
  }
  const rank = {call: 0, you: 1, check: 2};
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

// Parsing is a pass over up to 8KB per project, and the panel repaints often.
const _inboxMemo = new Map();
function inboxItems(folder, host) {
  const text = ccTodo(folder, host);
  if (typeof text !== 'string' || !text) return [];
  let hit = _inboxMemo.get(text);
  if (!hit) {
    if (_inboxMemo.size > 200) _inboxMemo.clear();
    hit = parseInbox(text);
    _inboxMemo.set(text, hit);
  }
  return hit;
}

// ── local activity ──────────────────────────────────────────────────────────
let _activity = {};
let _activitySig = '';
let _activityBusy = false;
let _activityAt = 0;
let _openTs = {};          // conn + "\n" + folder -> when this panel last opened it

function ensureActivity(force) {
  if (_activityBusy || !window.ccBridge?.activity) return;
  if (!force && Date.now() - _activityAt < ACTIVITY_MS) return;
  _activityBusy = true;
  window.ccBridge.activity().then(a => {
    _activityBusy = false;
    _activityAt = Date.now();
    if (!a || typeof a !== 'object') return;
    const sig = JSON.stringify(a);
    // Only repaint when something moved: this runs on a timer and a repaint
    // resets the list's scroll position.
    if (sig === _activitySig) return;
    _activitySig = sig;
    _activity = a;
    rebuildPanel();
  }).catch(() => { _activityBusy = false; });
}

function noteOpenTimes(ws) {
  _openTs = {};
  for (const w of ws) _openTs[w.conn + '\n' + w.folder] = Math.max(_openTs[w.conn + '\n' + w.folder] || 0, w.ts || 0);
}

// ── remote scan ─────────────────────────────────────────────────────────────
const _remote = {};   // host -> {state:'loading'|'ok'|'err', at, user, error, projects, byPath}

const remoteProject = (host, folder) => _remote[host]?.byPath?.[folder];
const remoteTodo    = (host, folder) => remoteProject(host, folder)?.todo;

function scanRemote(host) {
  const prev = _remote[host] || {};
  _remote[host] = {...prev, state: 'loading', at: Date.now()};
  const done = patch => {
    _remote[host] = {...(_remote[host] || {}), at: Date.now(), ...patch};
    // Deferred: with no bridge this runs inside rebuildPanel itself.
    queueMicrotask(rebuildPanel);
  };
  if (!window.ccBridge?.scanRemote) return done({state: 'err', error: 'no scan bridge - re-run update-ui.sh'});
  window.ccBridge.scanRemote(host).then(r => {
    if (!r || !r.ok) return done({state: 'err', error: (r && r.error) || 'scan failed'});
    const byPath = {};
    for (const p of r.projects || []) if (p && p.path) byPath[p.path] = p;
    done({state: 'ok', error: '', user: r.user || '', projects: r.projects || [], byPath});
  }).catch(e => done({state: 'err', error: String(e && e.message || e).slice(0, 120)}));
}

function ensureRemoteScans(hosts, force) {
  for (const host of hosts) {
    const r = _remote[host];
    if (r && r.state === 'loading') continue;
    if (!force && r && Date.now() - r.at < (r.state === 'err' ? REMOTE_RETRY : REMOTE_TTL)) continue;
    scanRemote(host);
  }
}

// A host counts toward the inbox by default only when its ssh user is root - the
// admin's own servers. Other accounts on a shared host are other people's 🧍.
// The per-host toggle overrides the default either way.
function inboxHostOn(host) {
  let o = {};
  try { o = JSON.parse(lsGet(INBOX_SKIP) || '{}') || {}; } catch {}
  if (typeof o[host] === 'boolean') return o[host];
  return _remote[host]?.user === 'root';
}
function setInboxHost(host, on) {
  let o = {};
  try { o = JSON.parse(lsGet(INBOX_SKIP) || '{}') || {}; } catch {}
  o[host] = !!on;
  lsSet(INBOX_SKIP, JSON.stringify(o));
}

// ── what the tiles ask for ──────────────────────────────────────────────────
//
// "Last touched" is the newest Claude session transcript, falling back to the
// last commit, then the TODO's mtime, only when the project has no session. Not
// max() of them: a fleet sweep committed to 25 of 33 folders in one afternoon, and
// with max() every one of them read as Active though nobody had worked in them for
// a week. A session is you working; a commit can be anything.
function projInfo(folder, host) {
  const now = Date.now();
  let ts = 0, live = false;
  const a = host ? remoteProject(host, folder) : _activity[folder];
  if (a) { ts = a.s || a.c || a.t || 0; live = !!a.s && now - a.s < LIVE_MS; }
  // Opening a project from this panel counts as touching it: the closest thing
  // to frecency available without tracking clicks separately.
  ts = Math.max(ts, _openTs[(host || 'Local') + '\n' + folder] || 0);
  // Standing checks (🧍 under Verification) are things to glance at, not things
  // the project is blocked on, so they neither count nor move it to a lane.
  const all = inboxItems(folder, host);
  const items = all.filter(i => i.kind !== 'check');
  return {ts, live, items, checks: all.length - items.length};
}

// ── rendering: lanes ────────────────────────────────────────────────────────
function laneHeader(text, tip, onClick) {
  const h = document.createElement(onClick ? 'button' : 'div');
  if (onClick) { h.type = 'button'; h.onclick = e => { e.stopPropagation(); onClick(); }; }
  h.title = tip;
  h.style.cssText = 'display:block;width:100%;text-align:left;border:0;background:transparent;' +
    'color:inherit;font:inherit;font-size:9px;font-weight:600;opacity:.5;letter-spacing:.04em;' +
    'text-transform:uppercase;margin:7px 0 2px;padding:0 2px;' + (onClick ? 'cursor:pointer;' : '');
  h.textContent = text;
  return h;
}

// Projects grouped into lanes, each lane a normal folderGrid. `opts` is passed
// straight through to it, so tiles look and behave exactly as before.
function buildLanes(conn, folders, wsRow, opts = {}) {
  const host = opts.remote ? conn : null;
  const now = Date.now();
  const buckets = {active: [], waiting: [], parked: [], dormant: []};
  for (const f of folders) {
    const i = projInfo(f, host);
    buckets[laneOf(i.ts, i.items.length > 0, now)].push({f, ts: i.ts});
  }
  const wrap = document.createElement('div');
  for (const lane of LANES) {
    const arr = buckets[lane.key]
      .sort((a, b) => (b.ts - a.ts) || a.f.localeCompare(b.f))
      .map(x => x.f);
    const shown = opts.mode === 'emoji' ? arr.filter(hasEmoji) : arr;
    if (!shown.length) continue;
    if (lane.key === 'dormant') {
      const open = dormantOpen();
      wrap.appendChild(laneHeader((open ? '▾ ' : '▸ ') + lane.label + ' · ' + shown.length, lane.tip,
        () => { lsSet(DORMANT_KEY, open ? '0' : '1'); rebuildPanel(); }));
      if (!open) continue;
    } else {
      wrap.appendChild(laneHeader(lane.label + ' · ' + shown.length, lane.tip));
    }
    wrap.appendChild(folderGrid(conn, arr, wsRow, opts));
  }
  return wrap;
}

// ── rendering: inbox ────────────────────────────────────────────────────────
// Every project with something waiting on you, most recently touched first.
function collectInbox(localFolders) {
  const groups = [];
  const add = (conn, host, folder) => {
    const i = projInfo(folder, host);
    if (i.items.length) groups.push({conn, host, folder, ts: i.ts, items: i.items, checks: i.checks});
  };
  for (const f of localFolders) add('Local', null, f);
  for (const host of Object.keys(_remote)) {
    if (!inboxHostOn(host)) continue;
    for (const p of _remote[host].projects || []) add(host, host, p.path);
  }
  return groups.sort((a, b) => b.ts - a.ts);
}

const KIND_TAG = {call: '🤔', you: '🧍'};

function buildInbox(groups, wsRow) {
  const col = document.createElement('div');
  col.style.cssText = 'min-width:0;';
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  col.appendChild(colHeader(total + ' waiting on you · ' + groups.length + ' projects'));
  if (!groups.length) {
    const none = document.createElement('div');
    none.textContent = 'Nothing is waiting on you.';
    none.style.cssText = 'font-size:11px;opacity:.5;padding:4px;';
    col.appendChild(none);
    return col;
  }
  for (const g of groups) {
    const raw = g.folder.split('/').filter(Boolean).pop() || g.folder;
    const row = document.createElement('div');
    row.style.cssText = 'margin:0 0 8px;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:baseline;gap:6px;font-size:11px;font-weight:600;';
    const name = document.createElement('button');
    name.type = 'button';
    name.title = g.folder;
    name.textContent = emojiSuffix(raw) + (g.host ? '  · ' + g.host : '');
    name.style.cssText = 'flex:1;min-width:0;text-align:left;border:0;background:transparent;' +
      'color:inherit;font:inherit;cursor:pointer;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    name.onclick = e => { e.stopPropagation(); pinTodoPreview(g.folder, g.host); };
    const age = document.createElement('span');
    age.textContent = ageLabel(g.ts);
    age.style.cssText = 'flex:none;font-size:9px;font-weight:400;opacity:.5;';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'open ↗';
    open.title = 'Start a session in this project';
    open.style.cssText = 'flex:none;border:0;background:transparent;color:inherit;cursor:pointer;' +
      'font:inherit;font-size:9px;font-weight:600;opacity:.6;padding:0 2px;';
    open.onclick = e => { e.stopPropagation(); pinTodoPreview(g.folder, g.host); clickWorkspace(g.conn, g.folder, wsRow); };
    head.append(name, age, open);
    row.appendChild(head);
    for (const it of g.items.slice(0, 6)) {
      const li = document.createElement('div');
      li.textContent = KIND_TAG[it.kind] + ' ' + it.text;
      li.style.cssText = 'font-size:10.5px;line-height:1.35;opacity:.85;padding:1px 0 1px 4px;overflow-wrap:anywhere;';
      row.appendChild(li);
    }
    const extra = g.items.length - 6, checks = g.checks || 0;
    if (extra > 0 || checks) {
      const more = document.createElement('div');
      more.textContent = [extra > 0 ? '+' + extra + ' more' : '', checks ? checks + ' standing check' + (checks > 1 ? 's' : '') : '']
        .filter(Boolean).join(' · ');
      more.style.cssText = 'font-size:9px;opacity:.45;padding-left:4px;';
      row.appendChild(more);
    }
    col.appendChild(row);
  }
  return col;
}

// Keep the live dots and lane assignments fresh while the panel is on screen.
// One timer, and a no-op when the panel is not in the DOM.
setInterval(() => {
  if (document.querySelector('.' + PANEL_CLS)) ensureActivity(true);
}, ACTIVITY_MS);
