// Help: the longer explanations for every page, so the pages themselves can stay short. "#help:<page>" opens a section.

import { h } from '../dom.js';

const p = (...parts) => h('p', {}, ...parts);
const list = (...items) => h('ul', {}, items.map((i) => h('li', {}, i)));
const b = (text) => h('strong', { text });
const code = (text) => h('code', { text });
const go = (id, text) => h('a', { href: `#${id}`, text });

// Each section's id matches the page it explains, so that page's "?" lands here.
const SECTIONS = [
  { id: 'stats', title: 'Dashboard', body: () => [
    p('An overview of your bookmarks. The big number is the total; the tiles below count what needs tidying and each opens the page that deals with it. Broken links and redirects show the result of the last link check, or a dash when links have not been checked yet.'),
    p('Charts show bookmarks by site, when they were added, where they live and the largest folders. Every chart has a ', b('Table'), ' switch with the full numbers. Select a site to list its bookmarks on ', go('all', 'All bookmarks'), '. ', b('Recently bookmarked'), ' lists your newest bookmarks; ', b('See all'), ' lists every one, newest first.'),
    p('Sites group subdomains, so docs.python.org counts as python.org. “Where they are” counts bookmarks under each top-level folder, subfolders included; “Largest folders” counts only bookmarks directly inside a folder. Under “URL types”, plain http URLs are not encrypted, and other types include bookmarklets (javascript:) and Firefox’s own pages.'),
  ] },
  { id: 'duplicates', title: 'Duplicates', body: () => [
    p('Bookmarks that point to the same URL, grouped. The number beside each copy is the order it was added: 1 is the oldest.'),
    p(b('All but oldest'), ' and ', b('All but newest'), ' select every copy except one in each group. Then remove them, or move them to a folder (set in ', go('settings', 'Settings'), ') to sort through later. ', b('Ignore'), ' adds bookmarks to the ignore list, which every check skips.'),
    p(b('All but topmost'), ' and ', b('All but bottommost'), ' keep the copy highest up or lowest down in your bookmarks instead, and ', b('Same-folder extras'), ' selects copies that share a folder with an older copy. To work by folder, choose one under ', b('Folder'), ': ', b('Select in folder'), ' selects the copies in it, and ', b('Keep the folder’s copy'), ' selects every other copy of each URL that has one there. Tick ', b('with subfolders'), ' to count the folders inside it too.'),
    p('What counts as “the same URL” is set under Duplicate matching in Settings: you can treat http and https, “www.”, trailing slashes, the part after #, the query string or letter case as the same, and add custom rules.'),
  ] },
  { id: 'empty-folders', title: 'Empty folders', body: () => [
    p('Folders with no bookmarks anywhere inside, only empty subfolders or separators. Only the outermost empty folder is listed, and removing it removes what is inside. Firefox’s own top-level folders are never listed.'),
  ] },
  { id: 'same-name', title: 'Same-name folders', body: () => [
    p('Folders in the same place with the same name. Merging keeps the first one and moves the others’ contents into it, then removes the emptied copies. After merging, the merged folder can hold same-name subfolders of its own; they then show up here too.'),
  ] },
  { id: 'untitled', title: 'No useful name', body: () => [
    p('Bookmarks whose name is blank, is its own URL (ignoring https://, www., case and a trailing slash), or is any bare web URL.'),
    p('The link check also reads the page title of each bookmark listed here, in the same request, and shows it as “Page title”. ', b('Fetch page titles'), ' uses those titles as they are and reads the other selected pages, then renames the bookmark to the page’s title. With cookies turned on for the link check it uses them too, so pages behind a login use the session you already have. Dead links and pages that send you to a login page are skipped. Pages without a usable title keep their name and show why. The renames are one step you can undo.'),
  ] },
  { id: 'broken', title: 'Broken links', body: () => [
    p('The link check makes one request per bookmarked page, which also gives the redirects and, for bookmarks without a useful name, the page title. It groups the failures: not found, server error, other client errors, unreachable (DNS, connection or TLS errors) and timed out. It needs permission to access websites, which it asks for the first time.'),
    p('The check loads each bookmarked page from its own site, as a logged-out visitor unless cookies are turned on in Settings. Addresses on your own network are skipped. A page that sends you to a login page is listed as “Redirects to a login page” here, not under Redirects.'),
    p('“Access denied” (401/403), “rate limited” (429) and login redirects often still work in the browser, especially when you are logged in, so look before removing them. Sites on the skip list in Settings are never checked; ', b('Check again'), ' re-checks only the selected bookmarks.'),
  ] },
  { id: 'redirects', title: 'Redirects', body: () => [
    p('Bookmarks whose URL now leads somewhere else, found by the link check. ', b('Fix'), ' replaces the saved URL with the one it redirects to. Check where it goes first: sites sometimes send removed pages to their home page, and fixing those would lose the original URL. A redirect to a different site is flagged, as the old site may have closed and its address been taken over by someone else. Redirects to a login page are kept out of this list.'),
  ] },
  { id: 'rules', title: 'Rules', body: () => [
    p('A list of rules, each with conditions that pick bookmarks and actions that change them. Add one with ', b('+ Rule'), '; select a rule’s name to open or close it. The ', b('☰'), ' menu renames, duplicates, moves up or down, merges and deletes a rule. Nothing changes until you apply the preview, and ', b('Save rules'), ' keeps your edits.'),
    h('h3', { text: 'Conditions' }),
    p('Each condition holds one keyword. It looks at the title, the URL or a part of it (site name, URL path, query string, part after #), and checks whether it contains the keyword, does not contain it, starts or ends with it, is exactly it, or matches it as a regex; a site name can also be on a domain, and a query string can have a parameter. ', b('Rule'), ' sets whether any, all, none or not all of a rule’s conditions must hold, and ', b('+ Group'), ' nests conditions with their own setting, so several keywords are several conditions in an “any” group; a group’s ▸ closes and opens it. Drag a condition or group by its ⠿ handle to move it, into another group too; ', b('⧉'), ' adds a copy beside it, and ', b('↗'), ' moves it into a new rule just below with the same actions and folder conditions. ', b('Merge…'), ' in a rule’s menu does the reverse: the rule you pick has its conditions joined to this rule’s as an “any” alternative and is then removed; this rule keeps its own actions.'),
    p(b('Whole words'), ' (off by default) stops a keyword matching inside other words, so “cat” does not match “category”. ', b('Aa'), ' matches upper and lower case exactly. A ', b('folder'), ' condition limits a rule to bookmarks in a folder, with or without its subfolders, and follows that folder when it is renamed or moved. A ', b('rule'), ' condition holds when another rule’s conditions do, or do not, hold for the bookmark: “does not match” lets a higher rule step aside, with all its actions, for what a lower rule handles, whatever the list order. It follows that rule when it is renamed or moved, a disabled rule still counts, and rules that refer to each other in a loop are reported and left out.'),
    h('h3', { text: 'Actions' }),
    p('A rule takes its actions in order on every bookmark it matches:'),
    list(
      [b('Move to folder'), ': files the bookmark into a folder, created if it does not exist. The rule follows the folder when you rename or move it, here or in Firefox. A bookmark already in that folder or below it stays where it is.'],
      [b('Find and replace'), ': replaces text in the name, the URL or both, as on the Find and replace page.'],
      [b('Rename to page title'), ' and ', b('Use redirect target'), ': use the page title or the address a redirect leads to. The last link check’s findings are used when there are any; otherwise the page is read when you apply, which asks once for permission to access websites.'],
      [b('Ignore'), ': adds the bookmark to the ignore list, so every check and these rules skip it from then on.'],
      [b('Delete'), ': removes the bookmark; no later action or rule runs on it.']),
    h('h3', { text: 'Order' }),
    p('Rules run from the top of the list down, and every rule that matches takes its actions, so a later rule works on what earlier ones left. Conditions are checked against the bookmark as it is now. When several rules move a bookmark, the highest rule’s move wins and the moves below it are skipped. Drag a rule by its ⠿ handle, or use ', b('Move up'), ' and ', b('Move down'), ', to change the order; each action’s ↑ and ↓ do the same within a rule.'),
    h('h3', { text: 'Preview and applying' }),
    p('The preview lists every bookmark the rules would change, grouped by the first rule that acts on it, in the order of the rules, with the text that rule matched highlighted, each step and the rule it comes from, and what the name and URL become. Each group’s ▸ closes it. Untick anything you do not want, then ', b('Apply selected'), '. Your rule changes are saved at the same time, and all the changes are one step you can undo; joining the ignore list is undone from the Settings page instead. ', b('Not matched by any rule'), ' lists the bookmarks the rules leave alone.'),
    p(b('Run on new bookmarks'), ' in a rule also applies it to each new bookmark a few seconds after it is added. It leaves a bookmark alone if you pick a folder for it yourself in that time (for example in the star panel), and skips bursts of many new bookmarks at once, as during an import or sync. Pages are read for new bookmarks only when the add-on already has permission to access websites.'),
  ] },
  { id: 'find-replace', title: 'Find and replace', body: () => [
    p('Replaces text in the names, the URLs or both of all your bookmarks. As you type, the page lists every bookmark that would change, with the found text highlighted and what its name and URL become below it. Matching ignores letter case unless ', b('Match case'), ' is ticked. Leave ', b('Replace with'), ' empty to delete the text.'),
    p(b('Regex'), ' treats the search as a regular expression; the replacement can then use ', code('$&'), ' for the whole match, ', code('$1'), '… for groups and ', code('$<name>'), ' for named groups. A change that would leave a URL that is not a valid address is shown but left out. ', b('Replace selected'), ' or ', b('Replace all'), ' makes the changes as one step you can undo.'),
  ] },
  { id: 'all', title: 'All bookmarks', body: () => [
    p('Your bookmarks as a tree of folders, managed like Firefox’s Library. Select a folder’s ▸ (or press → and ←) to open and close it; ', b('Expand all'), ' and ', b('Collapse all'), ' do every folder at once, and ', h('kbd', { text: '*' }), ' opens everything inside the focused folder. Double-click or press Enter to open a bookmark, in a new tab (in the sidebar, the current tab).'),
    p('Click selects a row, Ctrl-click adds or removes one, and Shift-click or Shift with the arrow keys selects a range. Right-click, or the ', b('Organize'), ' button, for the actions: open in a new tab, window, private window or container tab, open all of a folder’s bookmarks in tabs (or middle-click the folder), new bookmark, folder or separator, ', b('Bookmark all tabs'), ' (this window’s tabs into a new folder; it asks once for permission to read tab addresses), undo and redo, cut, copy, paste, delete, sort a folder by name and properties (name and URL). New items go inside an open folder, at the top, or just below the selected item. Typing letters jumps to the next name starting with them.'),
    p('Drag rows to move them before, after or into another folder; hold Ctrl while dropping to copy instead. Holding over a closed folder opens it. Links dragged in from a page, a tab or the address bar become new bookmarks, and URLs pasted with ', h('kbd', { text: 'Ctrl+V' }), ' do too. Moving or renaming a folder takes the rules that name it along. Every change is one step you can undo, with the toast’s Undo or ', h('kbd', { text: 'Ctrl+Z' }), ', and redo with ', h('kbd', { text: 'Ctrl+Shift+Z' }), ' or ', h('kbd', { text: 'Ctrl+Y' }), ' until you make a new change.'),
    p('The details pane under the tree shows the selected item’s name, URL, folder and date added, and edits them in place: Enter or leaving a field saves, Esc puts back what was there.'),
    p(b('Columns'), ' chooses which columns to show. ', b('Most recent visit'), ' and ', b('Visit count'), ' come from your browsing history, so the first time you turn one on Firefox asks for permission to read it; the numbers are read again after a minute. ', b('Video length'), ' shows how long the main video on a bookmarked page is. To fill it in, select bookmarks or folders and choose ', b('Find video lengths'), ' in the right-click menu; it reads each page’s video details (as video sites and most pages with an embedded video publish them) and turns the column on. Pages that build their video player with scripts name no length in their HTML; for those, choose ', b('Find video lengths in full pages'), ', which does the same and then opens each page it found no length for in a minimized, muted window, lets the page load, and reads the length of its longest video. It is slower, uses your sign-ins, and the visits show in your history. Select a page to see why it has no length. ', b('Add video length to names'), ' writes the found length at the start of each selected bookmark’s name, such as “[3:34] Talk”, so Firefox’s own menus and toolbar show it too; ', b('Remove video length from names'), ' takes it off again. Both are one step you can undo.'),
    p('Select a column heading to sort the view by that column, again to reverse it, and a third time for the saved order. Sorting the view does not change your bookmarks (use ', b('Sort by name'), ' for that), and while it is on, drops go into folders only.'),
    p('Searching by name, URL or folder, or choosing only duplicates, only non-duplicates or ', b('Recently added'), ' (newest first), lists the matches with their folder, 200 at a time; ', b('Show in folder'), ' in the right-click menu takes you to one in the tree. ', b('Import and backup'), ' saves every bookmark as an HTML file other browsers can import, or imports such a file into a new folder in Other Bookmarks. It also backs up to JSON and restores from a JSON backup, either this add-on’s or one saved by Firefox’s Library (Import and Backup › Backup…). Restoring replaces every bookmark with the backup’s, as one step you can undo; Firefox’s saved searches in a backup are left out, as add-ons cannot create them. Tags, keywords and visit counts are not available to add-ons, so they are not shown.'),
  ] },
  { id: 'history', title: 'History & backup', body: () => [
    p('Every change made here is recorded before it happens, so it can be undone. Undo works newest first, and restored bookmarks come back in their old place. Changes older than 30 days are forgotten; Settings sets that age and how many changes are kept.'),
    p('After an undo, ', b('Redo'), ' at the top applies the change again; making a new change clears what could be redone.'),
    p(b('Download full backup'), ' saves every bookmark as a JSON file. ', b('Restore from backup…'), ' replaces all your bookmarks with those in such a file, or in a JSON backup from Firefox’s Library (Bookmarks › Manage bookmarks › Import and Backup › Backup…); the restore can be undone. Firefox also keeps its own automatic backups there.'),
  ] },
  { id: 'settings', title: 'Settings', body: () => [
    h('h3', { text: 'Sync and backup' }),
    p('Settings, rules and ignored items sync between your devices through Firefox Sync. It needs Firefox signed in to a Mozilla account, with Add-ons ticked in Firefox’s Sync settings. The most recent change wins, and a newly installed copy takes the synced settings instead of overwriting them. When the ignore list is too large for Sync, only settings and rules are synced.'),
    p('A settings file (Export / Import) holds your settings, rules and ignored items; undo history stays on the device. Importing replaces your settings and adds the file’s ignored items to yours.'),
    h('h3', { text: 'Duplicate matching' }),
    p('Two bookmarks are duplicates when their URLs match after the adjustments you tick. Custom rules go further: ', b('Exclude'), ' rules leave matching bookmarks out of the duplicate check, and ', b('Replace'), ' rules rewrite a URL before comparing (the bookmark itself is not changed). Each rule can have conditions, so it applies only if, or unless, another pattern matches the URL, name or folder path. Replacements may use ', code('$&'), ', ', code('$1'), '…, ', code('$URL'), ', ', code('$NAME'), ' (folder path and name) and ', code('$TITLE'), ', and may start with ', code('\\L'), ' or ', code('\\U'), ' to lower- or upper-case the result.'),
    h('h3', { text: 'Link checking' }),
    p('Parallel requests and the timeout tune the link check. A wait between pages on the same site checks that site’s pages one at a time with a pause between them, for sites that refuse quick repeated requests; other sites carry on meanwhile. Domains on the skip list, and their subdomains, are never checked, and neither, unless you untick it, are addresses on your own network: your computer, private IP addresses such as 192.168.x.x, and local names such as router.lan or a name with no dot.'),
    p(b('Send your cookies'), ' (off by default) checks each page as you, so logged-in pages are not mistaken for redirects. Loading a page as you can act on your account, as a delete, confirm or unsubscribe link would, so URLs containing any word on the never-send list are always checked without cookies.'),
    h('h3', { text: 'Opened pages' }),
    p('When this is on, opening a bookmarked page in a tab updates what the add-on knows about it: a page that is not found or fails is listed under Broken links, one that now redirects under Redirects, and one that loads fine leaves both. A bookmark without a useful name gets the page’s title to rename it with, and a page with a video gets its length. Turning it on asks for permission to access websites, see page loads and run scripts in pages. Private windows are left out.'),
    p('With login detection on, a redirect is treated as a login page when it lands on a listed login service, on a path such as ', code('/login'), ' or ', code('/signin'), ', or on a page whose return address (', code('next'), ', ', code('return_to'), ', ', code('continue'), '…) points back to the bookmark.'),
    h('h3', { text: 'Page titles' }),
    p('Fetch page titles reads the title from each page’s HTML. Pages that only set their title with scripts once they run cannot be named this way and are marked as such.'),
    p('Each check contacts only the bookmarked page’s own site; nothing is sent to the add-on’s author or anyone else.'),
    h('h3', { text: 'Ignored items' }),
    p('Ignored bookmarks and folders are skipped by every check. Stop ignoring one to bring it back.'),
    p(b('Ignore a folder…'), ' here, or ', b('Ignore folder and everything inside'), ' in the right-click menu of All bookmarks, also skips every bookmark and folder inside it, including ones added later, in every check and in Rules.'),
  ] },
  { id: 'shortcuts', title: 'Opening the add-on', body: () => [
    list(
      ['The toolbar button opens this page in a tab, and View › Sidebar › Ultimate Bookmark Manager opens it in the sidebar.'],
      [h('kbd', { text: 'Shift' }), '+', h('kbd', { text: 'F11' }), ' opens it; the sidebar shortcut can be set in about:addons › ⚙ › Manage Extension Shortcuts.'],
      ['Tools › Ultimate Bookmark Manager opens any page.'],
      ['In the address bar, type ', code('bm'), ', a space and a page name, for example ', code('bm broken'), '.'],
      ['The ', b('⟳'), ' button reloads bookmarks and settings; pages also refresh on their own when bookmarks change elsewhere.']),
  ] },
];

export default {
  id: 'help',
  label: 'Help',

  render(ctx) {
    const page = h('section', { class: 'help' },
      h('header', { class: 'view-header' }, h('div', {}, h('h1', { text: 'Help' }))),
      h('nav', { class: 'help-toc', 'aria-label': 'Help topics' },
        h('ul', {}, SECTIONS.map((s) => h('li', {}, h('a', { href: `#help:${s.id}`, text: s.title }))))),
      SECTIONS.map((s) => h('section', { class: 'help-section', id: `help-${s.id}` },
        h('h2', {}, s.title, s.id !== 'shortcuts' && h('a', { class: 'small help-open', href: `#${s.id}`, text: 'Open page' })),
        s.body())));
    // Scroll to the section asked for once the page is on screen.
    if (ctx.section) setTimeout(() => [...page.querySelectorAll('.help-section')].find((x) => x.id === `help-${ctx.section}`)?.scrollIntoView?.({ block: 'start' }), 0);
    return page;
  },
};
