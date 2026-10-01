# Ultimate Bookmark Manager

A Firefox add-on for finding and cleaning up problem bookmarks. Every change it makes is recorded first, so it can be undone.

## Features

- **Help** (last in the navigation): the full explanation of every page. Each page title has a **?** whose tooltip sums the page up in one line and which opens that page's section of Help; other controls carry short tooltips instead of paragraphs on the page.
- **Dashboard** (the page the add-on opens on): total bookmarks, your most recent bookmarks, then tiles for what needs tidying (duplicate copies, missing names, empty and same-name folders, broken links and redirects from the last check, bookmarks your rules would move, ignored items), each linking to its page. Charts show bookmarks by site (select a site to list its bookmarks), added per month, per top-level folder, the largest folders and URL types; each chart has a Table view with the full numbers. It also shows the oldest and newest bookmark, the deepest folder level and the number of separators.
- **Duplicates**: bookmarks that point to the same URL, grouped and numbered by the order they were added. You can select every copy except the oldest or the newest, then remove them or move them to a “Dupes” folder.
- **Matching options**: you can choose to treat http/https, `www.`, trailing slashes, fragments, query strings or letter case as the same.
- **Custom rules**: *exclude* rules take bookmarks out of the duplicate check by matching their URL, name or folder path against a regex. *Replace* rules rewrite the URL before comparing. They support `$&`, `$1`…, `$URL`, `$NAME`, `$TITLE`, and a leading `\L` or `\U` to change case.
- **Empty folders**: folders with no bookmarks anywhere inside.
- **Same-name folders**: folders with the same name in the same place, which you can merge into one.
- **No useful name**: bookmarks whose name is blank or just a URL. The link check reads their page titles in the same request it uses to check them, and *Fetch page titles* uses those as they are; for other pages it reads each selected page's HTML (with your cookies if you turn them on, so logged-in pages work) and renames the bookmark to its title. Pages that set their title with scripts can't be named this way and are marked as such. Dead links and login redirects are skipped, and pages without a usable title are marked with the reason. You can also edit them by hand or remove them.
- **Broken links**: a network check that groups results by kind of failure (404, server error, unreachable, timeout, access denied, login required…) under sticky headers. It checks as a logged-out visitor unless you turn on sending your cookies, which is never done for URLs such as logout, delete or confirm links, and it skips addresses on your own network.
- **Redirects**: bookmarks that now lead somewhere else, which you can fix one at a time or all at once. Redirects to a different site are flagged, since an expired domain can be taken over. Redirects to a login page are listed under Broken links instead.
- **Organize**: shows your whole folder tree, and each folder lists the rules that file bookmarks into it (add one with *+ Rule* on the folder's row, or create a subfolder with *+ Folder*; drag a rule by its handle onto a folder, or use *Move…* in its ☰ menu (with *Rename…*, *Duplicate*, *Merge…* and *Delete*), to change where it files; drag a folder onto another to move it, and the rules that name it follow; a search box and an *only folders with rules* switch help with large trees). A rule is a set of conditions, one keyword each: a bookmark's title, URL, or one part of the URL (site name, path, query string, or the part after #) contains, does not contain, starts or ends with, or is a keyword, matches a regex, has its site name on a domain, or has its query string carry a parameter (`list`, or with its value, `list=PL123`). A *folder* condition limits a rule to bookmarks in a folder, with or without its subfolders; it narrows the rule down but never makes its match more specific. Keyword conditions match anywhere by default, so "cat" also matches "category"; tick *Whole words* to match only whole words, which the rule's summary then flags as "(whole words)", as it flags *Aa* as "(exact case)". Its *Rule* setting requires any, all, none, or not all of its conditions, and conditions can be put in nested groups with their own setting, so several keywords are several conditions in an *any* group. Conditions and groups can be dragged between groups, copied, or moved into a new rule with the same destination, folder conditions and ranking; *Merge…* folds another rule into this one as an *any* alternative. Conditions are saved in [react-querybuilder](https://react-querybuilder.js.org/)'s query format, and the editor uses its layout; rules saved in the older format are converted the first time the add-on loads them, and when an older settings file is imported: each keyword list becomes a group of one-keyword conditions, and source folders become folder conditions.
  - **Which rule wins:** each rule has **Ranking** rows: it ranks above or below another rule, or above or below all other rules. Ranking above or below all other rules puts it in a top or bottom tier, decided first. Within a tier, a rule wins over any rule it ranks above, and rankings follow through other rules (if A ranks above B and B above C, A beats C); "ranks below" is the same link stored on the other rule. Rules are picked from a tree of folders with their rules under them, where a rule that would make a loop or go against a tier is greyed out (one that arrives by import or sync is flagged and ignored). Only between rules no ranking relates does the built-in ranking apply: conditions on the URL (URL, site name, path, query, domain, query parameter) always outrank keyword conditions (title, or title or URL), then more points win within each (exact URL 1000, path 100 + 10 per segment, exact query 80, subdomain or parameter with value 60, domain 50, parameter 30, other URL text 20; exact title 40, keyword 20, regex 15; text like "youtube.com/@channel" found in the URL scores as a site plus a path), then the newer rule. Only conditions that matched count, exclusions add nothing, and bookmarks already inside the winning rule's folder stay where they are.
  - *Not matched by any rule*, below the preview, lists the bookmarks no enabled rule matches, grouped by their folder.
  - Rules for folders that don't exist yet are listed separately, and the folder is created when the rule first moves something. Each rule shows as a one-line summary with its score, target and how many bookmarks it would move, and expands into its editor. You can preview and untick moves before applying them; the preview highlights the text each winning rule matched in the title and URL, and names the keywords. When several rules match a bookmark, *All N matching rules* lists them strongest first, with what each matched and why each loser lost (ranked below another rule by your lists, less specific, or older). New bookmarks can optionally be organized automatically; this is skipped when you pick a folder yourself in the star panel, or when many arrive at once, as during an import or sync.
- **All bookmarks**: every folder, bookmark and separator as a tree, managed like Firefox's Library: open and close folders, select with click, Ctrl-click, Shift-click and the arrow keys, and a right-click menu to open in a new tab, window, private window or container tab, open all in tabs (or middle-click a folder), add a bookmark, folder or separator, bookmark all tabs, undo and redo, cut, copy, paste, delete, sort a folder by name, and edit properties. A details pane edits the selected item in place. Drag to move before, after or into folders (Ctrl-drag copies), drop links from pages to bookmark them, sort the view by column, choose columns (including most recent visit and visit count from your history), list recently added bookmarks, export or import an HTML bookmarks file, and back up to or restore from JSON (this add-on's backups or Firefox's). Moving or renaming a folder takes the organize rules that name it along. Search lists matches with their folder, with filters for only duplicates or only non-duplicates.
- **Ignore list** (whitelist) and a **skip list** of domains the link check leaves alone.
- **Undo and redo history**, forgotten after 30 days by default (set in Settings), a **full JSON backup** download and a **restore** from it or from Firefox's own JSON backup.
- **Settings sync**: settings, organize rules and ignored items sync between your devices through Firefox Sync. This needs Add-ons ticked in Firefox's Sync settings, and can be turned off. The most recent change wins, and a new device adopts the synced settings instead of overwriting them.
- **Export / import settings** as a JSON file. Importing replaces your settings and adds the file's ignored items to yours.

## Opening it

- The toolbar button opens the dashboard in a tab.
- It also works in the sidebar: View › Sidebar › Ultimate Bookmark Manager.
- <kbd>Shift</kbd>+<kbd>F11</kbd> opens the dashboard. The sidebar toggle has no default key; set one in `about:addons` › ⚙ › Manage Extension Shortcuts.
- Tools › Ultimate Bookmark Manager › *view*.
- In the URL bar, type `bm` then a space and a view name, e.g. `bm broken`.

## Permissions

- **Bookmarks**, **storage** and **menus** are granted at install.
- **Access to all websites** is only requested when you first run a link check. It is needed so the add-on can load each bookmark's URL.
- **Containers** and **cookies** are granted at install, so bookmarks can open in container tabs.
- **Tabs** is only requested the first time you use *Bookmark all tabs*, to read the tabs' addresses and titles.
- **History** is only requested when you first turn on the *Most recent visit* or *Visit count* column.

## Privacy

The add-on collects no data and has no server. Bookmarks, settings and undo history stay in your browser; settings and ignored items sync through Firefox Sync only if you leave sync on.

Two features contact websites, and only when you start them:

- **Check links** requests each bookmarked URL once from that URL's own site, reading the start of the page only for bookmarks without a useful name, to get their title. Your cookies are not sent unless you turn that on in Settings, and addresses on your own network (your router, NAS, `localhost` and the like) are skipped.
- **Fetch page titles** requests the selected bookmarks' pages the same way, and only reads their HTML; it never opens them in a tab.

## Development

The add-on is plain JavaScript with no dependencies and no build step, and needs Firefox 140 or newer. The files in the repository are the files that ship.

```sh
npm test                 # unit tests (node:test)
npm run lint
npm start                # launches Firefox with the add-on loaded
npm run build            # packages the add-on into web-ext-artifacts/
```

To load it by hand, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and pick `manifest.json`.

| Path | Contents |
| --- | --- |
| `src/lib/` | Pure logic: tree helpers, duplicate matching, folder checks, link checking, settings, undoable actions |
| `src/ui/` | The dashboard/sidebar page, its views and shared components |
| `src/background.js` | Toolbar button, shortcut, Tools menu and address-bar keyword |
| `test/` | Unit tests, with an in-memory stand-in for the bookmarks API |
