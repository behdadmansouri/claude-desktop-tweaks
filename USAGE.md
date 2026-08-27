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

## Updating

```bash
claude-ctl update         # install what is available, then re-patch
claude-ctl update --force # ... even while the app is running
```

A systemd **user** timer runs `claude-ctl update` every 2h and does nothing while the app is
running, so updates land in the window after you quit.

```bash
./scripts/install-autoupdate.sh --status   # or --remove
```

The patched build currently has **no update source** (the AUR package was removed 2026-08-14);
only the official build updates. See TODO.md.

## Sharing sessions between the two builds

```bash
claude-ctl share      # official build shows the patched build's session list
claude-ctl unshare    # or scripts/share-sessions.sh --undo
```

Only the session *index* is linked. Transcripts under `~/.claude/projects/` were always shared,
and claude.ai chats are server-side. Enabled 2026-08-27.

## When something looks wrong

| Symptom | First move |
|---|---|
| Blank page | `~/.cache/claude-desktop-debian/launcher.log` - a GPU FATAL is self-healing now |
| Custom UI missing | `claude-ctl` reports patch freshness; re-run `update-ui.sh` |
| A selector needs measuring | `window.__ccDump()` in DevTools, then read `[cc-dump]` in `~/.config/Claude/logs/claude.ai-web.log` |
| Usage chip wrong | `window.__ccUsage()` |
| Window title wrong | `window.__ccTitleDebug()` |
| Sleep held open | `claude-ctl` lists every inhibitor KDE holds and why |
