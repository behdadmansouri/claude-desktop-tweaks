# Usage - the things you run

Scope: this laptop. Architecture and history live in [AGENTS.md](AGENTS.md); this is the
operator's page. Everything below is already on `PATH` via `~/.local/bin`.

## Day to day

```bash
claude-quit                     # kill every Claude process
./scripts/check-updates.sh --report   # last update-check result (also shown at session start)
./scripts/install-official.sh   # install the newest official build, then re-apply the patch
```

## Changing the patched UI

```bash
./scripts/update-ui.sh          # rebuild custom-ui.js from custom-ui/ and re-patch the official build
claude-quit                     # restart to load it
```

Edit `custom-ui/*.js`, never `custom-ui.js` (a build artifact). The file registry in
[AGENTS.md](AGENTS.md) says which module owns what.

## The project panel (new-session page)

- **Lanes:** Active (a Claude session in the last 7 days, else last commit), Waiting on you
  (quiet, with an open 🧍 or Needs-your-call item), Parked (up to 60 days), Dormant (older;
  click its header to open). Each lane is newest first.
- **Green dot:** a session wrote to that project in the last 3 minutes.
- **Inbox N:** every open 🧍 / Needs-your-call item across all projects and hosts. Standing checks
  under Verification are not counted. "open ↗" on a row starts a session there.
- **Remote column:** scans `~/AI Projects` over ssh on every configured host when the panel opens
  and every 5 minutes after. `↻` rescans one host. A host feeds the Inbox by default only when its
  ssh user is root; `inbox ✓/✗` on its heading overrides that.

## Updating

Run `./scripts/install-official.sh` after quitting the app; it re-applies the patch itself.
There is no autoupdate timer and no patched build (both retired 2026-09-23).
