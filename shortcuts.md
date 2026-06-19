# Claude Desktop — Keyboard Shortcuts

## Built-in Claude Desktop shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+N` | New chat |
| `Ctrl+Shift+F` | Open/close file picker (folder browser) |
| `Ctrl+;` | Open side chat |
| `Escape` | Close popup / cancel |

> Note: built-ins are not exhaustive — discovered by experimentation.

---

## Custom shortcuts (injected by custom-ui.js)

### Navigation
| Shortcut | Action |
|---|---|
| `Alt+1` … `Alt+9` | Jump to Nth chat in the sidebar |
| `Ctrl+1` | Switch to Chat mode |
| `Ctrl+2` | Switch to Cowork mode |
| `Ctrl+3` | Switch to Code mode |
| `Ctrl+O` | Open search (same as Ctrl+K built-in) |
| `Ctrl+Shift+L` | Toggle sidebar |

### Panels & views
| Shortcut | Action |
|---|---|
| `Ctrl+Shift+R` | Toggle right panel (artifact / code / preview) |
| `Ctrl+W` | Close file viewer / dismiss preview overlay (repurposed — native Ctrl+W was redundant with Ctrl+N) |

### App control
| Shortcut | Action |
|---|---|
| `Ctrl+Q` | Quit Claude Desktop (clean shutdown) |

---

## Sidebar features

- **Numbers 1-9** appear before the first 9 sidebar chats — use `Alt+N` to jump to them.
- **📌 Pin button** appears on hover beside each chat title. Pinned chats get an amber outline.
- **Cache ring** — amber outline on a chat title means the prompt cache for that chat is still warm (< 5 min since last active).

---

## Usage bar (top-right chip)

`C35%  H5%  2h  W44%  3d`

| Badge | Meaning |
|---|---|
| `C` (blue) | Context window used |
| `H` (yellow) | 5-hour plan used |
| `2h` (gray) | Hours until 5-hour limit resets |
| `W` (green) | Weekly plan used |
| `3d` (gray) | Days until weekly limit resets |

Click the chip to dismiss it (reappears on next page navigation).

---

## Workspace panel

Hover over the workspace row on the new-session page to open the folder picker panel.
Folders are arranged in two columns when the list is long.
The "+" button next to a project in the sidebar opens a new session directly in that folder.

---

## To re-enable the new-session overview

The activity/overview section is hidden by default. To bring it back temporarily:

```js
localStorage.setItem('ccShowOverview', '1'); location.reload();
```

To re-hide:

```js
localStorage.removeItem('ccShowOverview'); location.reload();
```
