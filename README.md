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
- **Organize**: shows your whole folder tree, and each folder lists the rules that file bookmarks into it (add one with *+ Rule* on the folder's row; a search box and an *only folders with rules* switch help with large trees). A rule matches when a bookmark's title or address contains, starts or ends with, or equals any of a list of keywords (entered as removable chips), is on a domain, or matches a regex. Keyword conditions match **whole words** by default, so "cat" does not match "category"; untick *Whole words* to match inside words too, which the rule's summary then flags as "(also inside words)". It can require any, all or none of its conditions, and conditions can be put in nested groups with their own any / all / none setting. A rule can be limited to bookmarks in chosen folders, with or without their subfolders; otherwise it looks everywhere.
  - **Which rule wins:** when several rules match a bookmark, the highest **priority** wins (a number you can set per rule, 0 by default), then normal rules over fallback rules over catch-alls, then the most **specific** match, then the newest rule. Specificity counts only the conditions that matched: exact address 1000, address path 100 + 10 per path segment, subdomain 60, domain 50, exact title 40, each keyword 20, each regex 15. Exclusions add nothing. Bookmarks already inside the winning rule's folder stay where they are.
  - A **fallback rule** keeps its conditions but only wins when no normal rule matches: tick *Fallback* on a broad rule like "site: youtube.com → YouTube" so that a more specific rule such as "CCNA → Career" takes the CCNA videos, while other YouTube videos still go to YouTube. Fallback rules rank below normal rules and above catch-alls; priority still overrides both.
  - A **catch-all rule** files whatever no other rule matches in the folders it looks in (for example, everything else in Other Bookmarks → Inbox). It loses to any matching rule unless you give it a higher priority, and must be limited to at least one folder.
  - Rules for folders that don't exist yet are listed separately, and the folder is created when the rule first moves something. Each rule shows as a one-line summary with its score, target and how many bookmarks it would move, and expands into its editor. You can preview and untick moves before applying them; the preview highlights the text each winning rule matched in the title and address, and names the keywords. New bookmarks can optionally be organized automatically; this is skipped when you pick a folder yourself in the star panel, or when many arrive at once, as during an import or sync.
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
