# Ultimate Bookmark Manager

[![Build](https://img.shields.io/github/actions/workflow/status/BeatLink/Ultimate-Bookmark-Manager/ci.yml?branch=main&label=build&logo=githubactions&logoColor=white)](https://github.com/BeatLink/Ultimate-Bookmark-Manager/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/github/actions/workflow/status/BeatLink/Ultimate-Bookmark-Manager/tests.yml?branch=main&label=tests&logo=nodedotjs&logoColor=white)](https://github.com/BeatLink/Ultimate-Bookmark-Manager/actions/workflows/tests.yml)
[![Coverage](https://img.shields.io/codecov/c/github/BeatLink/Ultimate-Bookmark-Manager?logo=codecov&logoColor=white)](https://codecov.io/gh/BeatLink/Ultimate-Bookmark-Manager)
[![Mozilla publishing](https://img.shields.io/github/actions/workflow/status/BeatLink/Ultimate-Bookmark-Manager/release.yml?label=AMO%20publish&logo=firefoxbrowser&logoColor=white)](https://github.com/BeatLink/Ultimate-Bookmark-Manager/actions/workflows/release.yml)

A Firefox add-on for finding and cleaning up problem bookmarks: duplicates, broken links, redirects, bookmarks without a name, empty folders, and bookmarks that belong in a different folder. Every change it makes is recorded first, so it can be undone.

## What it does

Each page of the add-on deals with one kind of problem. The **?** beside a page's title sums it up in a sentence and opens the full explanation on the **Help** page.

### Dashboard

The page the add-on opens on. It shows:

- the total number of bookmarks and your most recent ones;
- tiles for what needs tidying — duplicate copies, missing names, empty and same-name folders, broken links and redirects from the last check, bookmarks your rules would move, and ignored items — each linking to its page;
- charts of bookmarks by site (select a site to list its bookmarks), added per month, per top-level folder, the largest folders and URL types, each with a table view of the full numbers;
- the oldest and newest bookmark, the deepest folder level and the number of separators.

### Duplicates

Bookmarks that point to the same URL, grouped and numbered by the order they were added. Select every copy except the oldest or the newest, then remove them or move them to a “Dupes” folder.

What counts as the same URL is set in **Settings**:

- **Matching options** treat `http`/`https`, `www.`, trailing slashes, fragments, query strings or letter case as the same.
- **Custom rules** go further. *Exclude* rules leave bookmarks out of the check when their URL, name or folder path matches a regex. *Replace* rules rewrite the URL before comparing, with `$&`, `$1`…, `$URL`, `$NAME`, `$TITLE` and a leading `\L` or `\U` to change case.

### Empty and same-name folders

- **Empty folders** lists folders with no bookmarks anywhere inside.
- **Same-name folders** lists folders with the same name in the same place, which you can merge into one.

### No useful name

Bookmarks whose name is blank or just a URL. *Fetch page titles* renames them after the title their page shows:

- The link check already reads the title of each unnamed bookmark in the same request it uses to check it, and those titles are used as they are.
- Other pages have their HTML read, with your cookies if you turn them on, so logged-in pages work too.
- Dead links and login redirects are skipped. Pages that only set their title with scripts, or have no usable title, keep their name and show why.

You can also edit the names by hand or remove the bookmarks.

### Broken links and redirects

One network check serves both pages. It loads each bookmarked page once, from the page's own site, as a logged-out visitor unless you turn on sending your cookies — which is never done for URLs such as logout, delete or confirm links. Addresses on your own network are skipped.

- **Broken links** groups the failures by kind: not found, server error, unreachable, timed out, access denied, login required, and so on.
- **Redirects** lists bookmarks that now lead somewhere else, which you can fix one at a time or all at once. A redirect to a different site is flagged, since an expired domain can be taken over. Redirects to a login page are listed under Broken links instead.

### Organize

Rules that file bookmarks into folders. The page shows your whole folder tree, with each folder's rules listed under it.

**Rules.** A rule is a set of conditions, one keyword each: the bookmark's title, URL, or one part of the URL (site name, path, query string, or the part after `#`) contains, does not contain, starts or ends with, or is a keyword; matches a regex; has its site name on a domain; or has a query parameter (`list`, or with its value, `list=PL123`). The rule's setting requires any, all, none or not all of its conditions, and conditions can be nested in groups with their own setting. Keywords match anywhere unless *Whole words* is ticked, and ignore case unless *Aa* is. A *folder* condition limits a rule to bookmarks in a folder, with or without its subfolders.

**Editing.** Add a rule with *+ Rule* on a folder's row, or create a subfolder with *+ Folder*. Drag a rule onto a folder, or use *Move…* in its ☰ menu (beside *Rename…*, *Duplicate*, *Merge…* and *Delete*), to change where it files. Drag a folder onto another to move it, and the rules that name it follow. Conditions and groups can be dragged between groups, copied, or moved into a new rule with the same destination, folder conditions and ranking. A search box and an *only folders with rules* switch help with large trees.

**Which rule wins** when several match a bookmark:

1. A rule set to rank above or below *all other rules* sits in a top or bottom tier, decided first.
2. Within a tier, a rule's **Ranking** rows decide: a rule wins over any rule it ranks above, and rankings follow through other rules (if A ranks above B and B above C, A beats C). Rules that would make a loop or go against a tier cannot be chosen; one that arrives by import or sync is flagged and ignored.
3. Between rules no ranking relates, the more specific match wins. Conditions on the URL always outrank keyword conditions; within each, more points win (exact URL 1000; path 100 + 10 per segment; exact query 80; subdomain or parameter with value 60; domain 50; parameter 30; other URL text 20; exact title 40; keyword 20; regex 15). Only the conditions that matched count.
4. Finally, the newer rule wins.

Bookmarks already inside the winning rule's folder stay where they are.

**Preview and apply.** The preview lists every bookmark the rules would move, grouped by destination, with the matched text highlighted. *All N matching rules* shows every rule that matched, strongest first, and why each loser lost. Untick anything you do not want, then move the rest; the move is one undoable step. Rules for folders that do not exist yet are listed separately, and the folder is created when the rule first moves something. *Not matched by any rule* lists what the rules leave alone.

New bookmarks can be organized automatically a few seconds after they are added. This is skipped when you pick a folder yourself in the star panel, or when many arrive at once, as during an import or sync.

Conditions are stored in [react-querybuilder](https://react-querybuilder.js.org/)'s query format, and the editor uses its layout. Rules saved in an older format are converted when they are first loaded or imported.

### All bookmarks

Every folder, bookmark and separator as a tree, managed like Firefox's Library:

- Open and close folders, select with click, Ctrl-click, Shift-click and the arrow keys.
- The right-click menu opens bookmarks in a new tab, window, private window or container tab; opens all of a folder in tabs (or middle-click the folder); adds a bookmark, folder or separator; bookmarks all tabs; undoes and redoes; cuts, copies, pastes and deletes; sorts a folder by name; and edits properties. A details pane edits the selected item in place.
- Drag to move before, after or into folders (Ctrl-drag copies), and drop links from pages to bookmark them. Moving or renaming a folder takes the organize rules that name it along.
- Sort the view by column and choose columns, including most recent visit and visit count from your history. Search lists matches with their folder, with filters for only duplicates, only non-duplicates, or recently added.
- Export or import an HTML bookmarks file, and back up to or restore from JSON — this add-on's backups or Firefox's own.

### Shared by every page

- **Ignore list**: ignored bookmarks and folders are skipped by every check and by Organize. A folder can be ignored with everything inside it, including bookmarks added to it later.
- **Skip list**: domains the link check leaves alone.
- **Undo and redo history**, forgotten after 30 days by default, plus a full JSON backup and restore.
- **Settings sync** through Firefox Sync (Add-ons must be ticked in Firefox's Sync settings). The most recent change wins, and a new device adopts the synced settings instead of overwriting them. It can be turned off.
- **Export / import settings** as a JSON file. Importing replaces your settings and adds the file's ignored items to yours.

## Opening it

- The toolbar button opens the dashboard in a tab.
- View › Sidebar › Ultimate Bookmark Manager opens it in the sidebar.
- <kbd>Shift</kbd>+<kbd>F11</kbd> opens the dashboard. The sidebar toggle has no default key; set one in `about:addons` › ⚙ › Manage Extension Shortcuts.
- Tools › Ultimate Bookmark Manager › *page*.
- In the URL bar, type `bm`, a space and a page name, e.g. `bm broken`.

## Permissions

| Permission | When it is asked for | Why |
| --- | --- | --- |
| Bookmarks, storage, menus | At install | The add-on's own work |
| Containers, cookies | At install | Opening bookmarks in container tabs |
| Access to all websites | The first link check | Loading each bookmark's URL |
| Tabs | The first *Bookmark all tabs* | Reading the tabs' addresses and titles |
| History | Turning on the *Most recent visit* or *Visit count* column | Reading visit dates and counts |

## Privacy

The add-on collects no data and has no server. Bookmarks, settings and undo history stay in your browser; settings and ignored items sync through Firefox Sync only if you leave sync on.

Two features contact websites, and only when you start them:

- **Check links** requests each bookmarked URL once from that URL's own site, reading the start of the page only for bookmarks without a useful name. Your cookies are not sent unless you turn that on in Settings, and addresses on your own network (your router, NAS, `localhost` and the like) are skipped.
- **Fetch page titles** requests the selected bookmarks' pages the same way and only reads their HTML; it never opens them in a tab.

## Development

The add-on is plain JavaScript with no runtime dependencies and no build step, and needs Firefox 140 or newer. The files in the repository are the files that ship; `web-ext-config.mjs` lists the ones left out of the package.

```sh
npm install              # test-only tools: happy-dom gives the UI tests a page to render into
npm test                 # unit tests (node:test)
npm run coverage         # the same tests with a coverage table; coverage/lcov.info is what CI sends to Codecov
npm run lint             # Mozilla's add-on lint
npm start                # launches Firefox with the add-on loaded
npm run build            # packages the add-on into web-ext-artifacts/
```

To load it by hand, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and pick `manifest.json`.

| Path | Contents |
| --- | --- |
| `src/lib/` | Pure logic: tree helpers, duplicate matching, folder checks, link checking, organize rules, settings and sync, undoable actions |
| `src/ui/` | The dashboard/sidebar page, its views and shared components |
| `src/background.js` | Toolbar button, shortcut, Tools menu, address-bar keyword, automatic organizing and settings sync |
| `test/` | Unit tests, with in-memory stand-ins for the bookmarks API and storage, and happy-dom for the UI |
| `amo-metadata.json` | The addons.mozilla.org listing: summary, description, category, links and license |
| `.github/workflows/` | CI on every push and pull request, and the release to addons.mozilla.org |

## Releasing

CI runs the tests, the Mozilla lint and a package build on every push to `main` and every pull request.

Pushing a version tag publishes to [addons.mozilla.org](https://addons.mozilla.org) as a listed add-on:

1. Once: create an API key at [addons.mozilla.org › Developer Hub › Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/), then add it on GitHub under **Settings › Environments › amo** as the secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. The environment can also require your approval before each release.
2. Set `version` in `manifest.json` and `package.json`, and commit.
3. Tag and push: `git tag v0.1.1 && git push origin v0.1.1`.

The release job checks that the tag matches the manifest version, runs the tests and lint, submits the version for Mozilla's review, and creates a GitHub release with the package attached. Listed versions are signed once Mozilla has reviewed them. When uploading by hand instead, leave Firefox for Android unticked: Android has no bookmarks API.

## License

Ultimate Bookmark Manager is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE).

The condition editor's layout in `src/ui/query-editor.css` is adapted from [react-querybuilder](https://react-querybuilder.js.org/) under the MIT license, whose notice is kept in that file.
