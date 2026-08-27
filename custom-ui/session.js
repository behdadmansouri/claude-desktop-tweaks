// ─────────────────────────────────────────────────────────────
//  SESSION FACTS
//  What the current route is actually a session OF - project folder, title,
//  model, and how many tokens the last turn was holding.
// ─────────────────────────────────────────────────────────────
//
// The renderer knows `/epitaxy/local_<uuid>` and nothing else, which is the
// single cause behind two separate long-standing complaints: the window title
// (and so every ActivityWatch event) can only ever say "Code", and the context
// figure exists only while the usage popover is open.
//
// The app writes both facts to disk. `cc-session-info` in the main process
// reads them; this is the renderer half - one cache, so the title watcher and
// the usage chip do not each pay for the same lookup on their own timers.
//
// Deliberately synchronous-with-stale-data: callers run on 3s/20s ticks and
// want an answer now, not a promise. The first call after a route change
// returns null and starts a fetch; the next tick has it.

const SI_TTL_MS = 15000;
// "/epitaxy/local_3b5ee74f-…" - the last segment, when it looks like an id
// rather than a page name. Kept loose on the prefix: local_ is what a local
// session uses today, and a remote one should not need a code change here.
const SI_ID_RE = /^[a-z]+_[0-9a-f][0-9a-f-]{7,}$/i;

let _siId = null;
let _siData = null;
let _siAt = 0;
let _siPending = false;

function ccSessionId() {
  const parts = (location.pathname || '').split('/').filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : '';
  return SI_ID_RE.test(last) ? last : '';
}

// The cached record, or null while one is being fetched (or when the route is
// not a session at all). Never throws, never blocks.
function ccSessionInfo() {
  const id = ccSessionId();
  if (!id) return null;
  if (id !== _siId) { _siId = id; _siData = null; _siAt = 0; }

  const now = Date.now();
  if (!_siPending && now - _siAt > SI_TTL_MS) {
    const bridge = window.ccBridge;
    if (bridge && bridge.sessionInfo) {
      _siPending = true;
      try {
        bridge.sessionInfo(id).then(d => {
          // Guard against a reply landing after the route already moved on -
          // showing one session's token count under another session's name is
          // exactly the failure the usage chip's route check exists to prevent.
          if (_siId === id) { _siData = d || null; _siAt = Date.now(); }
          _siPending = false;
        }).catch(() => { _siPending = false; _siAt = Date.now(); });
      } catch (_) {
        _siPending = false;
        _siAt = now;
      }
    } else {
      // No bridge (an unpatched main process, or an older patch): stop asking
      // every tick.
      _siAt = now;
    }
  }
  return _siData;
}
