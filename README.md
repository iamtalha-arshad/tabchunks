# TabChunks

A Chrome extension that saves a set of tabs as a named, colored **chunk**, closes them to free up your browser, and restores them later with one click.

When you restore a chunk, tabs that were in a Chrome tab group go back into that group with the same name and color. Tabs that were not in a group open on their own.

## Features

- **Save selected tabs** from the current window as a named chunk, then close them or keep them open.
- **Group-aware selection**: tabs are listed under your existing Chrome tab groups. Tick a group's header to select the whole group; its name and color fill in for you.
- **Name and color** each chunk, and rename or recolor it later.
- **Restore** a chunk into the current window or a new window. The original tab groups are rebuilt, and ungrouped tabs stay ungrouped.
- **Browse saved chunks** as cards that show site icons, tab count and when each was saved. Expand a card to see its tabs (under their group labels), open a single tab, or remove one.
- **Search** across chunk names and the titles and URLs of the tabs inside them.
- **Undo** a deleted chunk.
- **Full-page view** with the save panel and saved chunks side by side.
- **Export and import** chunks as a JSON file for backup or to move them to another computer.
- **Keyboard shortcuts**, and light and dark themes that follow your system setting.

## Install

TabChunks isn't in the Chrome Web Store, so you load it as an unpacked extension:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder (`chrome_ext`).
4. Optional: pin TabChunks from the puzzle-piece menu in the toolbar.

After you change any of the files, click ↻ on the TabChunks card in `chrome://extensions` to reload it.

## How to use

### Save tabs
1. Click the TabChunks icon. The **Save tabs** tab opens.
2. Tick the tabs you want, or tick a group's header to take the whole group. You can use **Select all** and the filter box.
3. Type a name in **Name this chunk** and pick a color. If you leave the name empty, it's called something like `Chunk · Nov 13, 2:15 PM`.
4. Press **Save & close** (or Enter), or **Save only** to keep the tabs open.

### Restore tabs
1. Open the **Saved** tab.
2. Click **Restore** to open the tabs in the current window, or the window icon to open them in a new window.

### Manage chunks
- **Rename**: double-click the name, or click the ✏️ button. Press Enter to save or Esc to cancel.
- **Change color**: click the colored dot.
- **See tabs**: click the row of site icons to expand the card. Click a tab to open it, or click ✕ to remove it from the chunk.
- **Delete**: click 🗑. You can click **Undo** in the message that appears.

### Settings (⋮ menu)
| Setting | Default | What it does |
|---|---|---|
| Restore original tab groups | On | Rebuilds the tab groups the tabs were in. If off, every tab opens on its own. |
| Delete chunk after restoring | Off | Removes the chunk from your saved list after you restore it. |
| Export chunks | — | Downloads all chunks as a `.json` file. |
| Import chunks | — | Adds chunks from an exported file. Chunks you already have are skipped. Import opens the full view, because a file picker would close the popup. |

### Keyboard shortcuts
| Shortcut | Action |
|---|---|
| `Alt+Shift+K` | Open TabChunks |
| `Alt+Shift+S` | Save all unpinned tabs in the current window as a chunk and close them |
| `/` | Search saved chunks (inside the popup) |
| `Enter` | Save & close (while typing the chunk name) |

You can change the shortcuts at `chrome://extensions/shortcuts`.

## Privacy

**TabChunks does not collect, store or share any of your information with us or with any other service.**

- **No servers, no network requests.** The extension doesn't contact any website, API, analytics service or tracker. It contains no networking code.
- **No accounts, no tracking, no ads.**
- **Your chunks stay on your computer.** Saved chunks are kept in your own browser's local extension storage (`chrome.storage.local`) on this device. They're needed so you can restore your tabs later, and only you have access to them. They aren't synced to the cloud or to your Google account.
- **You're in control.** You can delete any chunk at any time. Removing the extension deletes all of its saved data.
- **Exports are yours.** An exported JSON file is saved only where you choose, and is never uploaded anywhere.

Site icons come from Chrome's own built-in icon cache (`_favicon`). The extension doesn't fetch them from the internet.

### Permissions used
| Permission | Why it's needed |
|---|---|
| `tabs` | Read the titles and URLs of your tabs so they can be saved, then close and reopen them. |
| `tabGroups` | Read your tab groups' names and colors, and recreate them on restore. |
| `storage` | Keep your saved chunks and settings locally on your device. |
| `favicon` | Show site icons from Chrome's local icon cache. |
| `contextMenus` | Add "Open TabChunks full view" to the toolbar icon's right-click menu. |

## Notes and limits

- Pinned tabs are restored as pinned. Chrome doesn't allow pinned tabs in groups, so they're never grouped.
- Chunks saved before group support was added restore all their tabs on their own.
- Uninstalling the extension deletes your saved chunks, so export them first if you want a backup.

## Project files

```
chrome_ext/
├── manifest.json   Extension settings, permissions and shortcuts (Manifest V3)
├── background.js   Saves, closes and restores tabs (keeps working if the popup closes)
├── popup.html      The popup and full-view page
├── popup.css       Styles, including dark mode
├── popup.js        The interface: tab list, chunk cards, search, rename, import/export
└── icons/          Toolbar and extension icons (16, 32, 48, 128 px)
```
