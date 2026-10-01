// Help: the longer explanations for every page, so the pages themselves can stay short. "#help:<page>" opens a section.

import { h } from '../dom.js';
import { POINTS } from '../../lib/specificity.js';

const p = (...parts) => h('p', {}, ...parts);
const list = (...items) => h('ul', {}, items.map((i) => h('li', {}, i)));
const b = (text) => h('strong', { text });
const code = (text) => h('code', { text });
const go = (id, text) => h('a', { href: `#${id}`, text });

// Each section's id matches the page it explains, so that page's "?" lands here.
const SECTIONS = [
  { id: 'stats', title: 'Dashboard', body: () => [
    p('An overview of your bookmarks. The big number is the total; the tiles below count what needs tidying and each opens the page that deals with it. Broken links and redirects show the result of the last link check, or a dash when links have not been checked yet.'),
    p('Charts show bookmarks by site, when they were added, where they live and the largest folders. Every chart has a ', b('Table'), ' switch with the full numbers. Select a site to list its bookmarks on ', go('all', 'All bookmarks'), '.'),
    p('Sites group subdomains, so docs.python.org counts as python.org. “Where they are” counts bookmarks under each top-level folder, subfolders included; “Largest folders” counts only bookmarks directly inside a folder. Under “URL types”, plain http URLs are not encrypted, and other types include bookmarklets (javascript:) and Firefox’s own pages.'),
  ] },
  { id: 'duplicates', title: 'Duplicates', body: () => [
    p('Bookmarks that point to the same URL, grouped. The number beside each copy is the order it was added: 1 is the oldest.'),
    p(b('All but oldest'), ' and ', b('All but newest'), ' select every copy except one in each group. Then remove them, or move them to a folder (set in ', go('settings', 'Settings'), ') to sort through later. ', b('Ignore'), ' adds bookmarks to the ignore list, which every check skips.'),
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
    p(b('Fetch page titles'), ' reads each selected page and renames the bookmark to the page’s title. With cookies turned on for the link check it uses them too, so pages behind a login use the session you already have. Pages that set their title with scripts are then opened in a minimized, muted window, unless that is turned off in Settings. Dead links and pages that send you to a login page are skipped. Pages without a usable title keep their name and show why. The renames are one step you can undo.'),
  ] },
  { id: 'broken', title: 'Broken links', body: () => [
    p('The link check asks each bookmarked page for a response and groups the failures: not found, server error, other client errors, unreachable (DNS, connection or TLS errors) and timed out. It needs permission to access websites, which it asks for the first time.'),
    p('The check loads each bookmarked page from its own site, as a logged-out visitor unless cookies are turned on in Settings. Addresses on your own network are skipped. A page that sends you to a login page is listed as “Redirects to a login page” here, not under Redirects.'),
    p('“Access denied” (401/403), “rate limited” (429) and login redirects often still work in the browser, especially when you are logged in, so look before removing them. Sites on the skip list in Settings are never checked; ', b('Check again'), ' re-checks only the selected bookmarks.'),
  ] },
  { id: 'redirects', title: 'Redirects', body: () => [
    p('Bookmarks whose URL now leads somewhere else, found by the link check. ', b('Fix'), ' replaces the saved URL with the one it redirects to. Check where it goes first: sites sometimes send removed pages to their home page, and fixing those would lose the original URL. Redirects to a login page are kept out of this list.'),
  ] },
  { id: 'organize', title: 'Organize', body: () => [
    p('Your folder tree, with the rules that file bookmarks into each folder listed under it. Add a rule with ', b('+ Rule'), ' on a folder’s row, or ', b('+ Rule for a new folder'), ' for a folder that does not exist yet; it is created when the rule first moves something. ', b('+ Folder'), ' creates a subfolder straight away, as a step you can undo. To change which folder a rule files into, drag it by its ⠿ handle onto that folder’s row, or use ', b('Move…'), ' in the rule’s ', b('☰'), ' menu, which also renames, duplicates, merges and deletes it. Select a rule’s name to open or close it. Drag a folder’s row onto another folder to move it inside; rules that file into it, or have a folder condition on it or anything inside it, follow it to its new place, and undoing the move puts them back. The search box and ', b('Only folders with rules'), ' help with large trees.'),
    h('h3', { text: 'Conditions' }),
    p('Each condition holds one keyword. It looks at the title, the URL or a part of it (site name, URL path, query string, part after #), and checks whether it contains the keyword, does not contain it, starts or ends with it, is exactly it, or matches it as a regex; a site name can also be on a domain, and a query string can have a parameter. ', b('Rule'), ' sets whether any, all, none or not all of a rule’s conditions must hold, and ', b('+ Group'), ' nests conditions with their own setting, so several keywords are several conditions in an “any” group. Drag a condition or group by its ⠿ handle to move it, into another group too; ', b('⧉'), ' adds a copy beside it, and ', b('↗'), ' moves it into a new rule with the same destination, folder conditions and ranking, where it can be ranked on its own. ', b('Merge…'), ' in a rule’s menu does the reverse: the rule you pick from the tree has its conditions joined to this rule’s as an “any” alternative, its ranking links moved over, and is then removed.'),
    p(b('Whole words'), ' (off by default) stops a keyword matching inside other words, so “cat” does not match “category”. ', b('Aa'), ' matches upper and lower case exactly. A ', b('folder'), ' condition limits a rule to bookmarks in a folder, with or without its subfolders; it narrows the rule down but adds nothing to how specific its match is, so a rule also needs a condition on the title or URL.'),
    h('h3', { text: 'Which rule wins' }),
    p('When several rules match a bookmark, each rule’s ', b('Ranking'), ' rows decide first. A rule set to rank above all other rules beats every rule that is not, and one set to rank below all other rules loses to every rule that is not. Within those tiers, a rule wins over any rule it ranks above, and rankings follow through other rules (if A ranks above B and B above C, A beats C). “Ranks below” is the same link seen from the other rule, so both rules always show it. Rules are chosen from a tree of your folders with each folder’s rules under it, where a rule that would make a loop or go against a tier is greyed out; a loop or such a link that arrives through an import or a sync is flagged and ignored until one is removed.'),
    p('Only between rules no list relates does the built-in ranking apply. Conditions on the URL always outrank keyword conditions, however many keywords match. Then more points win, counting only the conditions that matched (exclusions add nothing), then the newer rule:'),
    list(
      `exact URL ${POINTS.exactUrl}; URL path ${POINTS.path} + ${POINTS.pathSegment} per segment; exact query string ${POINTS.exactQuery}; subdomain or query parameter with a value ${POINTS.subdomain}; domain ${POINTS.domain}; query parameter ${POINTS.param}; other URL text ${POINTS.keyword}. Text like “youtube.com/@channel” found in a URL scores as a site plus a path.`,
      `Keyword conditions (title, or title or URL): exact title ${POINTS.exactTitle}; each keyword ${POINTS.keyword}; each regex ${POINTS.regex}.`),
    p('A rule’s chip shows the most it can score, for example “≤ URL 110” or “≤ keywords 40”, whether it ranks above or below all other rules, and how many rules it ranks above. Bookmarks already inside the winning rule’s folder stay where they are.'),
    h('h3', { text: 'Preview and applying' }),
    p('The preview lists every bookmark the rules would move, grouped by destination, with the text the winning rule matched highlighted. ', b('All matching rules'), ' lists every rule that matched, strongest first, with why each lost; select one to highlight what it matched. Untick anything you do not want, then ', b('Move'), '. Your rule changes are saved at the same time, and the move is one step you can undo.'),
    p(b('Organize new bookmarks automatically'), ' applies your rules to each new bookmark a few seconds after it is added. It leaves a bookmark alone if you pick a folder for it yourself in that time (for example in the star panel), and skips bursts of many new bookmarks at once, as during an import or sync.'),
  ] },
  { id: 'all', title: 'All bookmarks', body: () => [
    p('Your bookmarks as a tree of folders, managed like Firefox’s Library. Select a folder’s ▸ (or press → and ←) to open and close it; ', b('Expand all'), ' and ', b('Collapse all'), ' do every folder at once, and ', h('kbd', { text: '*' }), ' opens everything inside the focused folder. Double-click or press Enter to open a bookmark, in a new tab (in the sidebar, the current tab).'),
    p('Click selects a row, Ctrl-click adds or removes one, and Shift-click or Shift with the arrow keys selects a range. Right-click, or the ', b('Organize'), ' button, for the actions: open in a new tab, window or private window, open all of a folder’s bookmarks in tabs, new bookmark, folder or separator, cut, copy, paste, delete, sort a folder by name and properties (name and URL). New items go inside an open folder, at the top, or just below the selected item. Typing letters jumps to the next name starting with them.'),
    p('Drag rows to move them before, after or into another folder; hold Ctrl while dropping to copy instead. Holding over a closed folder opens it. Links dragged in from a page, a tab or the address bar become new bookmarks, and URLs pasted with ', h('kbd', { text: 'Ctrl+V' }), ' do too. Moving or renaming a folder takes the organize rules that name it along. Every change is one step you can undo, with the toast’s Undo or ', h('kbd', { text: 'Ctrl+Z' }), '.'),
    p('Select a column heading to sort the view by name, location or date added, again to reverse it, and a third time for the saved order. Sorting the view does not change your bookmarks (use ', b('Sort by name'), ' for that), and while it is on, drops go into folders only.'),
    p('Searching by name, URL or folder, or choosing only duplicates or only non-duplicates, lists the matches with their folder, 200 at a time; ', b('Show in folder'), ' in the right-click menu takes you to one in the tree. ', b('Import and backup'), ' saves every bookmark as an HTML file other browsers can import, or imports such a file into a new folder in Other Bookmarks. Tags, keywords and visit counts are not available to add-ons, so they are not shown.'),
  ] },
  { id: 'history', title: 'History & backup', body: () => [
    p('Every change made here is recorded before it happens, so it can be undone. Undo works newest first, and restored bookmarks come back in their old place. How many changes are kept is set in Settings.'),
    p(b('Download full backup'), ' saves every bookmark as a JSON file. Firefox also keeps its own backups: Bookmarks › Manage bookmarks › Import and Backup.'),
  ] },
  { id: 'settings', title: 'Settings', body: () => [
    h('h3', { text: 'Sync and backup' }),
    p('Settings, organize rules and ignored items sync between your devices through Firefox Sync. It needs Firefox signed in to a Mozilla account, with Add-ons ticked in Firefox’s Sync settings. The most recent change wins, and a newly installed copy takes the synced settings instead of overwriting them. When the ignore list is too large for Sync, only settings and rules are synced.'),
    p('A settings file (Export / Import) holds your settings, organize rules and ignored items; undo history stays on the device. Importing replaces your settings and adds the file’s ignored items to yours.'),
    h('h3', { text: 'Duplicate matching' }),
    p('Two bookmarks are duplicates when their URLs match after the adjustments you tick. Custom rules go further: ', b('Exclude'), ' rules leave matching bookmarks out of the duplicate check, and ', b('Replace'), ' rules rewrite a URL before comparing (the bookmark itself is not changed). Replacements may use ', code('$&'), ', ', code('$1'), '…, ', code('$URL'), ', ', code('$NAME'), ' (folder path and name) and ', code('$TITLE'), ', and may start with ', code('\\L'), ' or ', code('\\U'), ' to lower- or upper-case the result.'),
    h('h3', { text: 'Link checking' }),
    p('Parallel requests and the timeout tune the link check. Domains on the skip list, and their subdomains, are never checked, and neither, unless you untick it, are addresses on your own network: your computer, private IP addresses such as 192.168.x.x, and local names such as router.lan or a name with no dot.'),
    p(b('Send your cookies'), ' (off by default) checks each page as you, so logged-in pages are not mistaken for redirects. Loading a page as you can act on your account, as a delete, confirm or unsubscribe link would, so URLs containing any word on the never-send list are always checked without cookies.'),
    p('With login detection on, a redirect is treated as a login page when it lands on a listed login service, on a path such as ', code('/login'), ' or ', code('/signin'), ', or on a page whose return address (', code('next'), ', ', code('return_to'), ', ', code('continue'), '…) points back to the bookmark.'),
    h('h3', { text: 'Page titles' }),
    p('Fetch page titles reads the title from each page’s HTML. Some pages only set their title with scripts once they run; with the window option on, those are opened in a minimized, muted window to read the title, which is slower. Links whose URL contains a never-send-cookies word are never opened this way.'),
    p('Each check contacts only the bookmarked page’s own site; nothing is sent to the add-on’s author or anyone else. The window option opens pages as normal tabs, so they also appear in your browsing history.'),
    h('h3', { text: 'Ignored items' }),
    p('Ignored bookmarks and folders are skipped by every check. Stop ignoring one to bring it back.'),
  ] },
  { id: 'shortcuts', title: 'Opening the add-on', body: () => [
    list(
      ['The toolbar button opens this page in a tab, and View › Sidebar › Bookmark Manager opens it in the sidebar.'],
      [h('kbd', { text: 'Shift' }), '+', h('kbd', { text: 'F11' }), ' opens it; the sidebar shortcut can be set in about:addons › ⚙ › Manage Extension Shortcuts.'],
      ['Tools › Bookmark Manager opens any page.'],
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
