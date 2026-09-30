# Bookmark Manager

A Firefox add-on for finding and cleaning up problem bookmarks. Every change it makes is recorded first, so it can be undone.

## Features

- **Help** (last in the navigation): the full explanation of every page. Each page title has a **?** whose tooltip sums the page up in one line and which opens that page's section of Help; other controls carry short tooltips instead of paragraphs on the page.
- **Dashboard** (the page the add-on opens on): total bookmarks, then tiles for what needs tidying (duplicate copies, missing names, empty and same-name folders, broken links and redirects from the last check, bookmarks your rules would move, ignored items), each linking to its page. Charts show bookmarks by site (select a site to list its bookmarks), added per month, per top-level folder, the largest folders and URL types; each chart has a Table view with the full numbers. It also shows the oldest and newest bookmark, the deepest folder level and the number of separators.
- **Duplicates**: bookmarks that point to the same URL, grouped and numbered by the order they were added. You can select every copy except the oldest or the newest, then remove them or move them to a “Dupes” folder.
- **Matching options**: you can choose to treat http/https, `www.`, trailing slashes, fragments, query strings or letter case as the same.
- **Custom rules**: *exclude* rules take bookmarks out of the duplicate check by matching their URL, name or folder path against a regex. *Replace* rules rewrite the URL before comparing. They support `$&`, `$1`…, `$URL`, `$NAME`, `$TITLE`, and a leading `\L` or `\U` to change case.
- **Empty folders**: folders with no bookmarks anywhere inside.
- **Same-name folders**: folders with the same name in the same place, which you can merge into one.
- **No useful name**: bookmarks whose name is blank or just a URL. *Fetch page titles* reads each selected page's HTML (with your cookies, so logged-in pages work) and renames the bookmark to its title. Pages that set their title with scripts are opened in a minimized, muted window, which can be turned off in Settings. Dead links and login redirects are skipped, and pages without a usable title are marked with the reason. You can also edit them by hand or remove them.
- **Broken links**: a network check that groups results by kind of failure (404, server error, unreachable, timeout, access denied, login required…) under sticky headers. It sends your cookies so logged-in pages are checked as you see them, except for URLs such as logout or unsubscribe links.
- **Redirects**: bookmarks that now lead somewhere else, which you can fix one at a time or all at once. Redirects to a login page are listed under Broken links instead.
- **Organize**: shows your whole folder tree, and each folder lists the rules that file bookmarks into it (add one with *+ Rule* on the folder's row; a search box and an *only folders with rules* switch help with large trees). A rule is a set of conditions, one keyword each: a bookmark's title, URL, or one part of the URL (site name, path, query string, or the part after #) contains, does not contain, starts or ends with, or is a keyword, matches a regex, has its site name on a domain, or has its query string carry a parameter (`list`, or with its value, `list=PL123`). A *folder* condition limits a rule to bookmarks in a folder, with or without its subfolders; it narrows the rule down but never makes its match more specific. Keyword conditions match **whole words** by default, so "cat" does not match "category"; untick *Whole words* to match inside words too, which the rule's summary then flags as "(also inside words)". Its *Rule* setting requires any, all, none, or not all of its conditions, and conditions can be put in nested groups with their own setting, so several keywords are several conditions in an *any* group. Conditions and groups can be dragged between groups, copied, or moved into a new rule with the same destination, folder conditions and ranking; *Merge…* folds another rule into this one as an *any* alternative. Conditions are edited with [react-querybuilder](https://react-querybuilder.js.org/) and saved in its query format; rules saved in the older format are converted the first time the add-on loads them, and when an older settings file is imported: each keyword list becomes a group of one-keyword conditions, and source folders become folder conditions.
  - **Which rule wins:** each rule has **Ranking** rows: it ranks above or below another rule, or above or below all other rules. Ranking above or below all other rules puts it in a top or bottom tier, decided first. Within a tier, a rule wins over any rule it ranks above, and rankings follow through other rules (if A ranks above B and B above C, A beats C); "ranks below" is the same link stored on the other rule. Rules are picked from a tree of folders with their rules under them, where a rule that would make a loop or go against a tier is greyed out (one that arrives by import or sync is flagged and ignored). Only between rules no ranking relates does the built-in ranking apply: conditions on the URL (URL, site name, path, query, domain, query parameter) always outrank keyword conditions (title, or title or URL), then more points win within each (exact URL 1000, path 100 + 10 per segment, exact query 80, subdomain or parameter with value 60, domain 50, parameter 30, other URL text 20; exact title 40, keyword 20, regex 15; text like "youtube.com/@channel" found in the URL scores as a site plus a path), then the newer rule. Only conditions that matched count, exclusions add nothing, and bookmarks already inside the winning rule's folder stay where they are.
  - A **catch-all rule** files whatever no other rule matches in the folders its folder conditions name (for example, everything else in Other Bookmarks → Inbox). It loses to any matching rule unless it is set to rank above it or above all other rules, and needs at least one folder condition.
  - Rules for folders that don't exist yet are listed separately, and the folder is created when the rule first moves something. Each rule shows as a one-line summary with its score, target and how many bookmarks it would move, and expands into its editor. You can preview and untick moves before applying them; the preview highlights the text each winning rule matched in the title and URL, and names the keywords. When several rules match a bookmark, *All N matching rules* lists them strongest first, with what each matched and why each loser lost (ranked below another rule by your lists, catch-all, less specific, or older). New bookmarks can optionally be organized automatically; this is skipped when you pick a folder yourself in the star panel, or when many arrive at once, as during an import or sync.
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
- In the URL bar, type `bm` then a space and a view name, e.g. `bm broken`.

## Permissions

- **Bookmarks**, **storage** and **menus** are granted at install.
- **Access to all websites** is only requested when you first run a link check. It is needed so the add-on can load each bookmark's URL.

## Development

The add-on is plain JavaScript and needs Firefox 140 or newer. Only the rule condition editor uses React: esbuild bundles `src/ui/query-editor.jsx` into `src/ui/query-editor.bundle.js`, which is not checked in.

```sh
npm install
npm test                 # unit tests (node:test)
npm run bundle           # builds the condition editor; lint, start and build run it first
npm run lint
npm start                # launches Firefox with the add-on loaded
npm run build            # packages the add-on into web-ext-artifacts/
```

To load it by hand, run `npm run bundle`, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and pick `manifest.json`.

| Path | Contents |
| --- | --- |
| `src/lib/` | Pure logic: tree helpers, duplicate matching, folder checks, link checking, settings, undoable actions |
| `src/ui/` | The dashboard/sidebar page, its views and shared components |
| `src/background.js` | Toolbar button, shortcut, Tools menu and address-bar keyword |
| `test/` | Unit tests, with an in-memory stand-in for the bookmarks API |
