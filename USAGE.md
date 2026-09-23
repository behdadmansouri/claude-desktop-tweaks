# Usage - the things you run

Scope: this laptop. Architecture and history live in [AGENTS.md](AGENTS.md); this is the
operator's page. Everything below is already on `PATH` via `~/.local/bin`.

## Day to day

```bash
claude-ctl            # what is installed, running, patched, shared, holding sleep open
claude-ctl page       # regenerate dashboard.html, then open it
claude-quit           # kill every Claude process
```

`claude-ctl` reads `check-updates.sh`'s cached answer for the network half, so it is fast and
works offline. It never installs anything on its own.

## Changing the patched UI

```bash
./scripts/update-ui.sh          # rebuild custom-ui.js from custom-ui/ and re-patch
./scripts/update-ui.sh --official   # same, against the official build
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

```bash
claude-ctl update         # install what is available, then re-patch
claude-ctl update --force # ... even while the app is running
```

There is no autoupdate timer (retired 2026-09-23); run it by hand after quitting the app.

The patched build currently has **no update source** (the AUR package was removed 2026-08-14);
only the official build updates. See TODO.md.
