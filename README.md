# Bookmark Manager

A Firefox add-on for finding and cleaning up problem bookmarks. Every change it makes is recorded first, so it can be undone.

## Features

- **Duplicates**: bookmarks that point to the same address, grouped and numbered by the order they were added. You can select every copy except the oldest or the newest, then remove them or move them to a “Dupes” folder.
- **Matching options**: you can choose to treat http/https, `www.`, trailing slashes, fragments, query strings or letter case as the same.
- **Custom rules**: *exclude* rules take bookmarks out of the duplicate check by matching their address, name or folder path against a regex. *Replace* rules rewrite the address before comparing. They support `$&`, `$1`…, `$URL`, `$NAME`, `$TITLE`, and a leading `\L` or `\U` to change case.
- **Empty folders**: folders with no bookmarks anywhere inside.
- **Same-name folders**: folders with the same name in the same place, which you can merge into one.
- **No name**: bookmarks with a blank name. You can edit them, name them after their address, or remove them.
- **Broken links**: a network check that groups results by kind of failure (404, server error, unreachable, timeout, access denied…) under sticky headers.
- **Redirects**: bookmarks that now lead somewhere else, which you can fix one at a time or all at once.
- **All bookmarks**: search everything, with filters for only duplicates or only non-duplicates.
- **Ignore list** (whitelist) and a **skip list** of domains the link check leaves alone.
- **Undo history** and a **full JSON backup** download.

## Opening it

- The toolbar button opens the dashboard in a tab.
- It also works in the sidebar: View › Sidebar › Bookmark Manager.
- <kbd>Shift</kbd>+<kbd>F11</kbd> opens the dashboard. The sidebar toggle has no default key; set one in `about:addons` › ⚙ › Manage Extension Shortcuts.
- Tools › Bookmark Manager › *view*.
- In the address bar, type `bm` then a space and a view name, e.g. `bm broken`.

## Permissions

- **Bookmarks**, **storage** and **menus** are granted at install.
- **Access to all websites** is only requested when you first run a link check. It is needed so the add-on can load each bookmark's address.

## Development

The add-on is plain JavaScript with no build step and needs Firefox 140 or newer.

```sh
npm test                 # unit tests (node:test)
web-ext lint             # or: nix run nixpkgs#web-ext -- lint
web-ext run              # launches Firefox with the add-on loaded
```

To load it by hand, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and pick `manifest.json`.

| Path | Contents |
| --- | --- |
| `src/lib/` | Pure logic: tree helpers, duplicate matching, folder checks, link checking, settings, undoable actions |
| `src/ui/` | The dashboard/sidebar page, its views and shared components |
| `src/background.js` | Toolbar button, shortcut, Tools menu and address-bar keyword |
| `test/` | Unit tests, with an in-memory stand-in for the bookmarks API |
