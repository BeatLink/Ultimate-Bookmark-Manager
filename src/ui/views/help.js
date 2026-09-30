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
    p(b('Fetch page titles'), ' opens each selected page in a minimized, muted window, waits for it to load (and a moment more for pages that set their title with scripts), and renames the bookmark to the title the page shows. Pages behind a login use the session you already have. Dead links are checked first and skipped. Pages without a usable title keep their name and show why. The renames are one step you can undo.'),
  ] },
  { id: 'broken', title: 'Broken links', body: () => [
    p('The link check asks each bookmarked page for a response and groups the failures: not found, server error, other client errors, unreachable (DNS, connection or TLS errors) and timed out. It needs permission to access websites, which it asks for the first time.'),
    p('“Access denied” (401/403) and “rate limited” (429) often still work in the browser, especially when you are logged in, so look before removing them. Sites on the skip list in Settings are never checked; ', b('Check again'), ' re-checks only the selected bookmarks.'),
  ] },
  { id: 'redirects', title: 'Redirects', body: () => [
    p('Bookmarks whose URL now leads somewhere else, found by the link check. ', b('Fix'), ' replaces the saved URL with the one it redirects to. Check where it goes first: sites sometimes send removed pages to their home or login page, and fixing those would lose the original URL.'),
  ] },
  { id: 'organize', title: 'Organize', body: () => [
    p('Your folder tree, with the rules that file bookmarks into each folder listed under it. Add a rule with ', b('+ Rule'), ' on a folder’s row, or ', b('+ Rule for a new folder'), ' for a folder that does not exist yet; it is created when the rule first moves something. The search box and ', b('Only folders with rules'), ' help with large trees.'),
    h('h3', { text: 'Conditions' }),
    p('A condition looks at the title, the URL or a part of it (site name, URL path, query string, part after #), and checks whether it contains any, all or none of a list of keywords, starts or ends with one, is exactly one, is on a domain, has a query parameter, or matches a regex. ', b('Inclusion'), ' sets whether any, all or none of a rule’s conditions must hold, and ', b('+ Group'), ' nests conditions with their own inclusion.'),
    p(b('Whole words'), ' (on by default) stops a keyword matching inside other words, so “cat” does not match “category”. ', b('Aa'), ' matches upper and lower case exactly. A rule’s ', b('Source folder'), ' limits it to bookmarks in chosen folders, with or without their subfolders; with none it looks everywhere.'),
    h('h3', { text: 'Which rule wins' }),
    p('When several rules match a bookmark, the ', b('Ranks above'), ' lists decide first: a rule wins over any rule it lists, and lists follow through other rules (if A ranks above B and B above C, A beats C). The menu never offers a rule that would make a loop; a loop that arrives through an import or a sync is flagged and its links ignored until one is removed.'),
    p('Only between rules no list relates does the built-in ranking apply. Conditions on the URL always outrank keyword conditions, however many keywords match. Then more points win, counting only the conditions that matched (exclusions add nothing), then the newer rule:'),
    list(
      `exact URL ${POINTS.exactUrl}; URL path ${POINTS.path} + ${POINTS.pathSegment} per segment; exact query string ${POINTS.exactQuery}; subdomain or query parameter with a value ${POINTS.subdomain}; domain ${POINTS.domain}; query parameter ${POINTS.param}; other URL text ${POINTS.keyword}. Text like “youtube.com/@channel” found in a URL scores as a site plus a path.`,
      `Keyword conditions (title, or title or URL): exact title ${POINTS.exactTitle}; each keyword ${POINTS.keyword}; each regex ${POINTS.regex}.`),
    p('A rule’s chip shows the most it can score, for example “≤ URL 110” or “≤ keywords 40”, and how many rules it ranks above. Bookmarks already inside the winning rule’s folder stay where they are.'),
    h('h3', { text: 'Catch-all rules' }),
    p('A catch-all has no conditions: it files whatever no other rule matches in its source folders, for example everything else in Other Bookmarks into Inbox. It must look in at least one folder, and any matching rule beats it unless it is set to rank above that rule.'),
    h('h3', { text: 'Preview and applying' }),
    p('The preview lists every bookmark the rules would move, grouped by destination, with the text the winning rule matched highlighted. ', b('All matching rules'), ' lists every rule that matched, strongest first, with why each lost; select one to highlight what it matched. Untick anything you do not want, then ', b('Move'), '. Your rule changes are saved at the same time, and the move is one step you can undo.'),
    p(b('Organize new bookmarks automatically'), ' applies your rules to each new bookmark a few seconds after it is added. It leaves a bookmark alone if you pick a folder for it yourself in that time (for example in the star panel), and skips bursts of many new bookmarks at once, as during an import or sync.'),
  ] },
  { id: 'all', title: 'All bookmarks', body: () => [
    p('Every bookmark, searchable by name, URL or folder, with filters for only duplicates or only bookmarks without duplicates. Results are shown 200 at a time.'),
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
    p('Parallel requests and the timeout tune the link check. Domains on the skip list, and their subdomains, are never checked.'),
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
