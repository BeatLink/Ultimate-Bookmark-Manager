# Bookmark Manager

A Firefox add-on for finding and cleaning up problem bookmarks. Every change it makes is recorded first, so it can be undone.

## Features

- **Dashboard** (the page the add-on opens on): total bookmarks, then tiles for what needs tidying (duplicate copies, missing names, empty and same-name folders, broken links and redirects from the last check, bookmarks your rules would move, ignored items), each linking to its page. Charts show bookmarks by site (select a site to list its bookmarks), added per month, per top-level folder, the largest folders and address types; each chart has a Table view with the full numbers. It also shows the oldest and newest bookmark, the deepest folder level and the number of separators.
- **Duplicates**: bookmarks that point to the same address, grouped and numbered by the order they were added. You can select every copy except the oldest or the newest, then remove them or move them to a “Dupes” folder.
- **Matching options**: you can choose to treat http/https, `www.`, trailing slashes, fragments, query strings or letter case as the same.
- **Custom rules**: *exclude* rules take bookmarks out of the duplicate check by matching their address, name or folder path against a regex. *Replace* rules rewrite the address before comparing. They support `$&`, `$1`…, `$URL`, `$NAME`, `$TITLE`, and a leading `\L` or `\U` to change case.
- **Empty folders**: folders with no bookmarks anywhere inside.
- **Same-name folders**: folders with the same name in the same place, which you can merge into one.
- **No useful name**: bookmarks whose name is blank or just a web address. *Fetch page titles* opens each selected page in a minimized, muted window and renames the bookmark to the title the page shows once loaded, including titles set by scripts or behind a login. Dead links are skipped, and pages without a usable title are marked with the reason. You can also edit them by hand or remove them.
- **Broken links**: a network check that groups results by kind of failure (404, server error, unreachable, timeout, access denied…) under sticky headers.
- **Redirects**: bookmarks that now lead somewhere else, which you can fix one at a time or all at once.
- **Organize**: shows your whole folder tree, and each folder lists the rules that file bookmarks into it (add one with *+ Rule* on the folder's row; a search box and an *only folders with rules* switch help with large trees). A rule matches when a bookmark's title, address, or one part of the address (site name, path, query string, or the part after #) contains, starts or ends with, or equals any of a list of keywords (entered as removable chips), is on a domain, has a query parameter (`list`, or with its value, `list=PL123`), or matches a regex. Keyword conditions match **whole words** by default, so "cat" does not match "category"; untick *Whole words* to match inside words too, which the rule's summary then flags as "(also inside words)". It can require any, all or none of its conditions, and conditions can be put in nested groups with their own any / all / none setting. A rule can be limited to bookmarks in chosen folders, with or without their subfolders; otherwise it looks everywhere.
  - **Which rule wins:** each rule has a **Ranks above** list. When a rule and one on its list both match a bookmark, the rule wins; lists follow through other rules (if A ranks above B and B above C, A beats C), and the menu never offers a rule that would make a loop (a loop that arrives by import or sync is flagged and its links ignored). Only between rules no list relates does the built-in ranking apply: conditions on the address (address, site name, path, query, domain, query parameter) always outrank keyword conditions (title, or title or address), then more points win within each (exact address 1000, path 100 + 10 per segment, exact query 80, subdomain or parameter with value 60, domain 50, parameter 30, other address text 20; exact title 40, keyword 20, regex 15; text like "youtube.com/@channel" found in the address scores as a site plus a path), then the newer rule. Only conditions that matched count, exclusions add nothing, and bookmarks already inside the winning rule's folder stay where they are.
  - A **catch-all rule** files whatever no other rule matches in the folders it looks in (for example, everything else in Other Bookmarks → Inbox). It loses to any matching rule unless it is set to rank above it, and must be limited to at least one folder.
  - Rules for folders that don't exist yet are listed separately, and the folder is created when the rule first moves something. Each rule shows as a one-line summary with its score, target and how many bookmarks it would move, and expands into its editor. You can preview and untick moves before applying them; the preview highlights the text each winning rule matched in the title and address, and names the keywords. When several rules match a bookmark, *All N matching rules* lists them strongest first, with what each matched and why each loser lost (ranked below another rule by your lists, catch-all, less specific, or older). New bookmarks can optionally be organized automatically; this is skipped when you pick a folder yourself in the star panel, or when many arrive at once, as during an import or sync.
- **All bookmarks**: search everything, with filters for only duplicates or only non-duplicates.
- **Ignore list** (whitelist) and a **skip list** of domains the link check leaves alone.
- **Undo history** and a **full JSON backup** download.
- **Settings sync**: settings, organize rules and ignored items sync between your devices through Firefox Sync. This needs Add-ons ticked in Firefox's Sync settings, and can be turned off. The most recent change wins, and a new device adopts the synced settings instead of overwriting them.
- **Export / import settings** as a JSON file. Importing replaces your settings and adds the file's ignored items to yours.

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
