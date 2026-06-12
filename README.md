# Claude Desktop UI Tweaks

Quality-of-life patches for the Claude Desktop Electron app.  
Works on **Linux**, **macOS**, and **Windows**.

---

## Features

### Usage badges in the title bar
Replaces the plain usage circle with five compact badges:

| Badge | Color | Meaning |
|-------|-------|---------|
| `C42%` | 🔵 Blue | Context window used |
| `H81%` | 🟠 Orange | Hourly plan used |
| `2h` | White/dim | Hours until hourly plan resets |
| `W45%` | 🟢 Green | Weekly usage |
| `3d` | White/dim | Days until weekly usage resets |

Hover any badge for a tooltip. Values dim until data loads.

### Quick workspace panel
On the new-session page, a floating panel appears above the workspace selector showing your recently used Local and SSH folders — click once to jump straight in, no dropdowns needed.

### Prompt-cache freshness ring
Conversations active within the last 5 minutes (Anthropic's prompt-cache TTL) get a red ring in the sidebar so you can instantly see which chats have a warm cache.

### Ctrl+Q to quit
Cleanly closes Claude Desktop from anywhere in the app.

### Top bar hidden
The electron window-controls bar is hidden to reclaim vertical space.  
Keyboard replacements:
- **Ctrl+O** — open search
- **Ctrl+Shift+L** — toggle sidebar

---

## Installation

### Prerequisites

- **Node.js** — [nodejs.org](https://nodejs.org/) (needed for `npx @electron/asar`)
- **Python 3** — [python.org](https://www.python.org/) (needed for the patch script)

### macOS

```bash
git clone https://github.com/behdadmansouri/claude-desktop-tweaks
cd claude-desktop-tweaks
bash install.sh
```

Quit and relaunch Claude Desktop.

> **Note:** macOS may ask for your password the first time because the script writes to `/Applications/Claude.app`. This is normal.

### Linux

```bash
git clone https://github.com/behdadmansouri/claude-desktop-tweaks
cd claude-desktop-tweaks
bash install.sh
```

If your Claude Desktop is in a non-standard location, pass the asar path explicitly:

```bash
bash install.sh /path/to/resources/app.asar
```

### Windows

Open **PowerShell** (no admin needed for user installs):

```powershell
git clone https://github.com/behdadmansouri/claude-desktop-tweaks
cd claude-desktop-tweaks
.\install.ps1
```

If auto-detection fails:

```powershell
.\install.ps1 -AsarPath "$env:LocalAppData\Programs\claude\resources\app.asar"
```

---

## Updating

When you pull a new version of `custom-ui.js`, just run the install script again — it knows how to update an already-patched installation:

```bash
git pull
bash install.sh          # Linux / macOS
.\install.ps1            # Windows
```

---

## After a Claude Desktop app update

Anthropic's updates replace `app.asar`, which overwrites the patch. Re-run the install script after updating Claude Desktop.

> The script creates `app.asar.bak` the first time so you can always restore the original.

---

## Restoring the original

```bash
# Linux / macOS
cp /path/to/resources/app.asar.bak /path/to/resources/app.asar

# Windows (PowerShell)
Copy-Item "$env:LocalAppData\Programs\claude\resources\app.asar.bak" `
          "$env:LocalAppData\Programs\claude\resources\app.asar"
```

---

## Does this work with the VS Code extension?

No — the VS Code Claude extension is an API client, not an Electron app. This patch only applies to the standalone Claude Desktop app.

---

## Platform notes

| Platform | Typical `app.asar` location |
|----------|-----------------------------|
| macOS | `/Applications/Claude.app/Contents/Resources/app.asar` |
| Linux (deb) | `/usr/lib/claude-desktop/resources/app.asar` |
| Linux (user) | `~/.local/lib/claude-desktop/resources/app.asar` |
| Windows | `%LocalAppData%\Programs\claude\resources\app.asar` |

---

## Security

The patch embeds `custom-ui.js` as a string in the Electron preload script (`mainView.js`). It runs in the renderer context — the same origin as `claude.ai`. No external network requests are made by the injected code; all state is stored in `localStorage`.

The original asar is backed up before any modifications.
