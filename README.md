# Claude Desktop — Custom UI Patches

Custom UI injection and keyboard shortcuts for the Claude Desktop Electron app.

---

## Features

| Category | Feature |
|----------|---------|
| **Usage tracking** | `C35% H81% 2h W45% 3d` badges (context, hourly, weekly + reset times) |
| **Keyboard** | Ctrl+Q (quit), Ctrl+O (search), Ctrl+Shift+L (sidebar), Ctrl+Shift+R (Files panel) |
| **Sidebar** | Chat number badges (1–9), Alt+1-9 shortcuts, pinnable chats, cache ring, rate-limit indicator |
| **Workspace** | Quick folder panel (hover-triggered) with Local + SSH columns |
| **Layout** | dframe layout fixes |
| **Dialogs** | Auto-dismiss startup popups, hide unavailable model banners |

**20+ features implemented.** See [CLAUDE.md](CLAUDE.md) for full details and [shortcuts.md](shortcuts.md) for keyboard reference.

---

## Quick Start

### Prerequisites
- **Node.js** — for `npx @electron/asar`
- **Python 3** — for patching script

### Setup (Linux/macOS)

```bash
bash scripts/install.sh
```

Then fully quit and restart Claude Desktop.

### Windows

```powershell
.\scripts\install.ps1
```

---

## Making Changes

```bash
# 1. Edit the relevant module in custom-ui/ (css.js, banners.js, usage.js,
#    workspace.js, sidebar.js, topbar.js, fbar.js, bootstrap.js — see CLAUDE.md
#    for what lives where). custom-ui.js itself is a generated build artifact.
code custom-ui/

# 2. Rebuild custom-ui.js and deploy patch
./scripts/update-ui.sh

# 3. Restart app
~/.local/bin/claude-quit && sleep 1
# Then launch from app menu
```

---

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — Architecture, how patching works, debugging
- **[TODO.md](TODO.md)** — Feature status and outstanding work
- **[shortcuts.md](shortcuts.md)** — All keyboard shortcuts
- **[memory/](memory/MEMORY.md)** — Architecture, design decisions, bug history

---

## Restoring Original

```bash
# Linux/macOS
cp /path/to/resources/app.asar.bak /path/to/resources/app.asar

# Windows (PowerShell)
Copy-Item "$env:LocalAppData\Programs\claude\resources\app.asar.bak" `
          "$env:LocalAppData\Programs\claude\resources\app.asar"
```

---

## Security

The patch embeds `custom-ui.js` in the Electron preload script. It runs in the renderer context with full DOM + localStorage access. No external network requests. All state persists locally.

---

## Repository

https://github.com/behdadmansouri/claude-desktop-tweaks
