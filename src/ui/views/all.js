// Every bookmark as a folder tree, managed like Firefox's Library: open, add, edit, move, copy, sort and remove.

import { h, toast, confirmDialog, promptDialog, fieldsDialog, showMenu, downloadFile, formatDate } from '../dom.js';
import { viewHeader } from '../components.js';
import { ROOT_IDS, nodeType, formatPath, pathTo } from '../../lib/tree.js';
import { snapshot, exportTree } from '../../lib/actions.js';
import { toBookmarkHtml, parseBookmarkHtml, countBookmarks } from '../../lib/bookmark-html.js';
import { parseBackup } from '../../lib/backup.js';
import { addToWhitelist, removeFromWhitelist } from '../../lib/settings.js';
import * as scans from '../scans.js';

const PAGE = 200;
const ROOT = 'root________';
const OTHER = 'unfiled_____';
const DRAG_TYPE = 'application/x-bookmark-manager-ids';
// Firefox asks before opening more tabs than this at once.
const MANY_TABS = 15;
const EXPANDED_KEY = 'all.expanded';
const COLUMNS_KEY = 'all.columns';
// Visit counts are read from history again when older than this.
const VISITS_MAX_AGE = 60000;

const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';

const loadExpanded = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPANDED_KEY));
    if (Array.isArray(saved)) return new Set(saved);
  } catch { /* storage may be unavailable */ }
  return new Set(['menu________', 'toolbar_____', OTHER]);
};

const loadColumns = () => {
  const columns = { location: true, added: true, visited: false, visits: false };
  try {
    Object.assign(columns, JSON.parse(localStorage.getItem(COLUMNS_KEY)));
  } catch { /* storage may be unavailable */ }
  return columns;
};

// Search, open folders, selection, sorting and the clipboard survive the re-render that follows every change.
const view = {
  query: '', filter: 'all', shown: PAGE,
  expanded: loadExpanded(),
  columns: loadColumns(),
  selected: new Set(), focus: null, anchor: null,
  sort: { key: null, dir: 1 },
  clipboard: null,
  active: false,
};

const saveExpanded = () => {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...view.expanded]));
  } catch { /* storage may be unavailable */ }
};

const saveColumns = () => {
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(view.columns));
  } catch { /* storage may be unavailable */ }
};

// Opens this page with the search box filled in or a filter chosen, e.g. a site or "recently added" on the dashboard.
export function showInAll(ctx, query, filter = 'all') {
  Object.assign(view, { query, filter, shown: PAGE, sort: { key: null, dir: 1 } });
  ctx.go('all');
}

// Each bookmarked URL's last visit and visit count from Firefox's history, read once permission is granted.
const visits = { map: null, at: 0, loading: null };
const visitOf = (n) => (n.url && visits.map?.get(n.url)) || null;
function loadVisits() {
  visits.loading ??= browser.history.search({ text: '', startTime: 0, maxResults: 1000000 })
    .then((items) => { visits.map = new Map(items.map((i) => [i.url, { last: i.lastVisitTime ?? 0, count: i.visitCount ?? 0 }])); })
    .catch(() => { visits.map = new Map(); })
    .finally(() => { visits.at = Date.now(); visits.loading = null; });
  return visits.loading;
}

// Asks for an optional permission; must be the first thing a click does, or Firefox refuses to ask.
const ask = (permission) => browser.permissions.request({ permissions: [permission] }).catch(() => false);

// Saves every bookmark as a JSON backup this page, or Firefox's Library, can restore.
export async function backupJson() {
  downloadFile(JSON.stringify(await exportTree(), null, 2), `bookmarks-backup-${new Date().toISOString().slice(0, 10)}.json`);
  toast('Backup downloaded.', 'success');
}

// Replaces every bookmark with those in a JSON backup, after asking; the restore is one step that can be undone.
export async function restoreBackup(ctx, file) {
  let parsed;
  try {
    parsed = parseBackup(await file.text());
  } catch (err) {
    return toast(err.message, 'error');
  }
  const left = parsed.skipped ? ` ${parsed.skipped} saved search(es) will be left out, as Firefox does not let add-ons create them.` : '';
  if (!(await confirmDialog(`Replace all your bookmarks with the ${parsed.bookmarks} in this backup?${left} You can undo this.`, 'Restore'))) return;
  await ctx.run(async () => {
    await ctx.actions.restore(parsed.folders, `Restored ${parsed.bookmarks} bookmark(s) from a backup`);
    ctx.done(`Restored ${parsed.bookmarks} bookmark(s) from the backup.`);
  });
}

const isFolder = (n) => nodeType(n) === 'folder';
const isBookmark = (n) => nodeType(n) === 'bookmark';
const validUrl = (text) => {
  try {
    new URL(text);
    return null;
  } catch {
    return 'Enter a full URL, such as https://example.com/.';
  }
};

const SORTERS = {
  title: (a, b) => (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base', numeric: true }),
  url: (a, b) => (a.url ?? '').localeCompare(b.url ?? ''),
  dateAdded: (a, b) => (a.dateAdded ?? 0) - (b.dateAdded ?? 0),
  visited: (a, b) => (visitOf(a)?.last ?? 0) - (visitOf(b)?.last ?? 0),
  visits: (a, b) => (visitOf(a)?.count ?? 0) - (visitOf(b)?.count ?? 0),
};

// The columns after Name, in order; `where` shows only in search results.
const COLUMNS = [
  { key: 'location', label: 'Location', sort: 'url', width: 'minmax(10em, 3fr)', text: (n) => n.url ?? '' },
  { key: 'where', label: 'Folder', width: 'minmax(8em, 2fr)' },
  { key: 'added', label: 'Added', sort: 'dateAdded', width: '7.5em', text: (n) => (nodeType(n) === 'separator' ? '' : formatDate(n.dateAdded)) },
  { key: 'visited', label: 'Most recent visit', sort: 'visited', width: '9em', text: (n) => formatDate(visitOf(n)?.last) },
  { key: 'visits', label: 'Visit count', sort: 'visits', width: '5.5em', text: (n) => (n.url ? String(visitOf(n)?.count ?? 0) : ''), num: true },
];

export default {
  id: 'all',
  label: 'All bookmarks',

  render(ctx) {
    const root = ctx.state.root;
    const byId = new Map();
    const index = (n) => { byId.set(n.id, n); n.children?.forEach(index); };
    index(root);
    const info = new Map(ctx.state.flat.map((f) => [f.id, f]));
    const get = (id) => byId.get(id);
    const bookmarkCount = ctx.state.flat.filter((b) => b.type === 'bookmark').length;
    const folderCount = ctx.state.flat.filter((b) => b.type === 'folder').length;

    for (const id of view.selected) if (!byId.has(id)) view.selected.delete(id);
    if (view.focus && !byId.has(view.focus)) view.focus = null;
    if (view.clipboard?.mode === 'cut') view.clipboard.ids = view.clipboard.ids.filter((id) => byId.has(id));

    const searching = () => view.query.trim() !== '' || view.filter !== 'all';
    const sorted = () => view.sort.key !== null;
    const isRootFolder = (n) => n.parentId === ROOT;
    // An item, or something holding it, is one of the given ids.
    const within = (id, ids) => {
      for (let n = get(id); n; n = get(n.parentId)) if (ids.has(n.id)) return true;
      return false;
    };
    // The selection without anything already inside a selected folder, in on-screen order.
    const topSelected = () => {
      const ids = view.selected;
      const order = new Map(rows.map((r, i) => [r.node.id, i]));
      return [...ids].filter((id) => !within(get(id)?.parentId, ids)).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    };
    const movable = (ids) => ids.filter((id) => !ROOT_IDS.has(id));
    // Nothing can go straight into the root, or into itself.
    const canPlace = (ids, parentId) => parentId !== ROOT && !ids.some((id) => within(parentId, new Set([id])));
    const folderMove = (id, parentId) => {
      const n = get(id);
      return isFolder(n) ? { id, from: pathTo(byId, id), to: [...pathTo(byId, parentId), n.title ?? ''] } : { id };
    };

    // ---- What is on screen ----
    let rows = [];
    const displayChildren = (folder) => {
      let kids = folder.children ?? [];
      if (folder.id === ROOT) kids = kids.filter((c) => c.id !== 'mobile______' || c.children?.length);
      if (!sorted()) return kids;
      const cmp = SORTERS[view.sort.key];
      return kids.filter((c) => nodeType(c) !== 'separator').sort((a, b) => cmp(a, b) * view.sort.dir);
    };
    const dupeIds = () => new Set(scans.duplicates(ctx).groups.flatMap((g) => g.items.map((i) => i.id)));
    const computeRows = () => {
      const out = [];
      if (searching()) {
        const q = view.query.trim().toLowerCase();
        const recent = view.filter === 'recent';
        const dupes = view.filter === 'dupes' || view.filter === 'unique' ? dupeIds() : null;
        let hits = ctx.state.flat.filter((f) => {
          if (f.type === 'separator' || (recent && f.type !== 'bookmark')) return false;
          if (dupes) {
            if (f.type !== 'bookmark') return false;
            if (view.filter === 'dupes' ? !dupes.has(f.id) : dupes.has(f.id)) return false;
          }
          return !q || f.title.toLowerCase().includes(q) || (f.url ?? '').toLowerCase().includes(q) || formatPath(f.path).toLowerCase().includes(q);
        }).map((f) => get(f.id));
        if (sorted()) hits = hits.sort((a, b) => SORTERS[view.sort.key](a, b) * view.sort.dir);
        else if (recent) hits = hits.sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0));
        total = hits.length;
        for (const n of hits.slice(0, view.shown)) out.push({ node: n, level: 0 });
      } else {
        const walk = (folder, level) => {
          for (const c of displayChildren(folder)) {
            out.push({ node: c, level });
            if (isFolder(c) && view.expanded.has(c.id)) walk(c, level + 1);
          }
        };
        walk(root, 0);
      }
      return out;
    };
    let total = 0;

    // ---- Elements ----
    const list = h('ul', { class: 'bm-tree', role: 'tree', 'aria-label': 'Bookmarks', 'aria-multiselectable': 'true' });
    const head = h('div', { class: 'bm-tree-head', role: 'presentation' });
    const wrap = h('div', { class: 'bm-tree-wrap' }, head, list);
    const status = h('p', { class: 'muted small tree-status' });
    const more = h('button', { text: 'Show more', onclick: () => { view.shown += PAGE; draw(); } });
    const rowEl = (id) => list.querySelector(`[data-id="${CSS.escape(id)}"]`);

    const sortButton = (key, label) => {
      const on = view.sort.key === key;
      return h('button', {
        type: 'button', class: `col-sort${on ? ' on' : ''}`, 'aria-sort': on ? (view.sort.dir > 0 ? 'ascending' : 'descending') : null,
        title: on ? (view.sort.dir > 0 ? 'Sorted A to Z; select to reverse' : 'Sorted Z to A; select to show the saved order') : `Sort the view by ${label.toLowerCase()}`,
        onclick: () => {
          if (!on) view.sort = { key, dir: 1 };
          else if (view.sort.dir > 0) view.sort = { key, dir: -1 };
          else view.sort = { key: null, dir: 1 };
          draw();
        },
      }, label, on && h('span', { 'aria-hidden': 'true', text: view.sort.dir > 0 ? ' ▲' : ' ▼' }));
    };

    const shownColumns = () => COLUMNS.filter((c) => (c.key === 'where' ? searching() : view.columns[c.key]));
    const showsVisits = () => view.columns.visited || view.columns.visits;

    const row = ({ node, level }) => {
      const type = nodeType(node);
      const folder = type === 'folder';
      const open = folder && !searching() && view.expanded.has(node.id);
      const name = type === 'separator'
        ? h('span', { class: 'sep-line', 'aria-label': 'Separator' })
        : h('span', { class: `bm-label${node.title ? '' : ' untitled'}`, text: node.title || (folder ? '(no name)' : node.url) });
      return h('li', {
        role: 'treeitem', class: `tree-row ${type}`, 'data-id': node.id, tabindex: '-1',
        draggable: ROOT_IDS.has(node.id) ? null : 'true',
        'aria-level': String(level + 1), 'aria-expanded': folder && !searching() ? String(open) : null,
        title: node.url ?? null, style: `--level: ${level}`,
      },
      h('span', { class: 'cell name' },
        h('span', { class: `twisty${folder && !searching() ? '' : ' none'}`, 'aria-hidden': 'true' }),
        type !== 'separator' && h('span', { class: `node-icon ${type}`, 'aria-hidden': 'true' }),
        name),
      shownColumns().map((c) => h('span', {
        class: `cell ${c.key}${c.num ? ' num' : ''}`,
        text: c.key === 'where' ? formatPath(info.get(node.id)?.path ?? []) : c.text(node),
      })));
    };

    // Rebuilds the rows, e.g. after a folder opens or the search changes; selection changes only repaint.
    const draw = () => {
      rows = computeRows();
      list.classList.toggle('searching', searching());
      wrap.style.setProperty('--cols', ['minmax(14em, 3fr)', ...shownColumns().map((c) => c.width)].join(' '));
      head.replaceChildren(sortButton('title', 'Name'), ...shownColumns().map((c) => (c.sort ? sortButton(c.sort, c.label) : h('span', { class: 'col-plain', text: c.label }))));
      list.replaceChildren(...rows.map(row));
      if (!rows.length) list.append(h('li', { class: 'tree-empty muted', text: searching() ? 'Nothing matches.' : 'No bookmarks.' }));
      more.hidden = !searching() || total <= view.shown;
      paint();
    };

    const paint = () => {
      const cut = new Set(view.clipboard?.mode === 'cut' ? view.clipboard.ids : []);
      for (const el of list.children) {
        const id = el.dataset.id;
        if (!id) continue;
        const on = view.selected.has(id);
        el.classList.toggle('selected', on);
        el.setAttribute('aria-selected', String(on));
        el.classList.toggle('cut', cut.has(id));
        el.tabIndex = id === view.focus ? 0 : -1;
      }
      if (!list.querySelector('[tabindex="0"]') && list.firstElementChild?.dataset.id) list.firstElementChild.tabIndex = 0;
      const n = view.selected.size;
      const counts = searching() ? `${total} found` : `${bookmarkCount} bookmarks in ${folderCount} folders`;
      status.textContent = n ? `${counts} · ${n} selected` : counts;
      drawDetails();
    };

    const focusRow = (id, scroll = true) => {
      view.focus = id;
      paint();
      const el = id && rowEl(id);
      if (!el) return;
      el.focus({ preventScroll: true });
      if (scroll) el.scrollIntoView({ block: 'nearest' });
    };

    // ---- Selection ----
    const indexOf = (id) => rows.findIndex((r) => r.node.id === id);
    const selectOnly = (id) => {
      view.selected = new Set(id ? [id] : []);
      view.anchor = id;
    };
    const selectTo = (id) => {
      const a = indexOf(view.anchor ?? id);
      const b = indexOf(id);
      if (a < 0 || b < 0) return selectOnly(id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      view.selected = new Set(rows.slice(lo, hi + 1).map((r) => r.node.id));
    };
    const toggleSelected = (id) => {
      if (view.selected.has(id)) view.selected.delete(id);
      else view.selected.add(id);
      view.anchor = id;
    };
    const selectAll = () => {
      view.selected = new Set(rows.map((r) => r.node.id));
      paint();
    };

    // ---- Folders opening and closing ----
    const setOpen = (id, open) => {
      if (open === view.expanded.has(id)) return;
      if (open) view.expanded.add(id);
      else {
        view.expanded.delete(id);
        // Closing a folder hides what was selected inside it, so the folder takes over the focus.
        for (const s of [...view.selected]) if (s !== id && within(s, new Set([id]))) view.selected.delete(s);
        if (view.focus && view.focus !== id && within(view.focus, new Set([id]))) view.focus = id;
      }
      saveExpanded();
      draw();
    };
    // Opens a folder and every folder above it.
    const revealFolder = (folderId) => {
      for (let n = get(folderId); n && n.id !== ROOT; n = get(n.parentId)) view.expanded.add(n.id);
      saveExpanded();
    };
    const setAllOpen = (open) => {
      if (open) for (const n of byId.values()) { if (isFolder(n) && n.id !== ROOT) view.expanded.add(n.id); }
      else view.expanded.clear();
      saveExpanded();
      if (!open && view.focus && !isRootFolder(get(view.focus))) {
        let top = get(view.focus);
        while (top && !isRootFolder(top)) top = get(top.parentId);
        selectOnly(top?.id ?? null);
        view.focus = top?.id ?? null;
      }
      draw();
      if (view.focus) focusRow(view.focus);
    };

    // ---- Opening bookmarks ----
    // `where` is 'tab', 'current', 'window' or 'private'; a container's cookie store opens the tabs in that container.
    const open = async (urls, where, cookieStoreId) => {
      if (!urls.length) return;
      if (urls.length > MANY_TABS && !(await confirmDialog(`Open ${urls.length} tabs?`, 'Open them', false))) return;
      try {
        if (where === 'window' || where === 'private') await browser.windows.create({ url: urls, incognito: where === 'private' });
        else if (where === 'current') await browser.tabs.update({ url: urls[0] });
        else for (const [i, url] of urls.entries()) await browser.tabs.create({ url, active: i === 0 && urls.length === 1, ...(cookieStoreId ? { cookieStoreId } : {}) });
      } catch (err) {
        const why = where === 'private' ? 'Firefox may need this add-on allowed in private windows (Add-ons › Ultimate Bookmark Manager › Run in Private Windows).' : 'Firefox does not let add-ons open some addresses, such as about: pages, file: and javascript: links.';
        toast(`Could not open: ${err.message ?? err}. ${why}`, 'error');
      }
    };
    const openInContainer = async (urls, x, y) => {
      let containers = [];
      try {
        containers = await browser.contextualIdentities.query({});
      } catch { /* containers are turned off */ }
      if (!containers?.length) return toast('Turn on container tabs in Firefox’s settings (General › Tabs) to open bookmarks in them.', 'error');
      showMenu(x, y, containers.map((c) => ({ label: c.name, run: () => open(urls, 'tab', c.cookieStoreId) })));
    };
    // Saves the tabs of this window, without repeats or blank pages, into a new folder.
    const bookmarkTabs = async () => {
      if (!(await ask('tabs'))) return toast('Bookmarking tabs needs permission to read their addresses.', 'error');
      const own = browser.runtime.getURL('');
      const seen = new Set();
      const tabs = (await browser.tabs.query({ currentWindow: true })).filter((t) => {
        if (!t.url || t.url.startsWith(own) || ['about:blank', 'about:newtab', 'about:home'].includes(t.url) || seen.has(t.url)) return false;
        seen.add(t.url);
        return true;
      });
      if (!tabs.length) return toast('There are no tabs to bookmark in this window.');
      const title = await promptDialog(`Bookmark ${tabs.length} tab(s) in a new folder named`, 'Bookmark tabs', `Tabs ${new Date().toLocaleDateString()}`);
      if (!title) return;
      await create([{ type: 'folder', title, children: tabs.map((t) => ({ type: 'bookmark', title: t.title || t.url, url: t.url })) }],
        `Bookmarked ${tabs.length} tab(s)`, `Bookmarked ${tabs.length} tab(s) in “${title}”.`);
    };
    const urlsOf = (ids) => ids.map(get).filter(isBookmark).map((n) => n.url);
    // A folder opens the bookmarks directly inside it, as Firefox's "Open All in Tabs" does.
    const folderUrls = (id) => (get(id).children ?? []).filter(isBookmark).map((n) => n.url);
    const activate = (id, where = ctx.isSidebar ? 'current' : 'tab') => {
      const n = get(id);
      if (isFolder(n) && !searching()) setOpen(id, !view.expanded.has(id));
      else if (isBookmark(n)) open([n.url], where);
    };

    // ---- Where new things go ----
    // Into an open folder at the top, otherwise just below the focused item; Other Bookmarks when nothing is focused.
    const insertionPoint = () => {
      const n = get(view.focus);
      if (!n) return { parentId: OTHER, index: null };
      if (isFolder(n) && (isRootFolder(n) || (!searching() && view.expanded.has(n.id)))) return { parentId: n.id, index: 0 };
      return { parentId: n.parentId, index: n.index + 1 };
    };
    // Selects new or moved items once the page re-renders, with their folder open.
    const afterCreate = (ids, parentId) => {
      if (!ids?.length) return;
      revealFolder(parentId);
      view.selected = new Set(ids);
      view.anchor = ids[0];
      view.focus = ids[0];
      view.active = true;
    };
    const create = (snaps, label, message, place = insertionPoint()) => ctx.run(async () => {
      if (searching() && snaps.length) Object.assign(view, { query: '', filter: 'all' });
      afterCreate(await ctx.actions.create(place.parentId, place.index, snaps, label), place.parentId);
      ctx.done(message);
    });

    const newBookmark = async () => {
      const values = await fieldsDialog('New bookmark', [
        { name: 'url', label: 'URL', placeholder: 'https://', spellcheck: 'false', validate: validUrl },
        { name: 'title', label: 'Name', placeholder: 'Leave blank to use the URL' },
      ], 'Add');
      if (!values) return;
      await create([{ type: 'bookmark', title: values.title, url: values.url }], `Added “${values.title || values.url}”`, `Added “${values.title || values.url}”.`);
    };
    const newFolder = async () => {
      const title = await promptDialog('Name of the new folder', 'Create folder', 'New Folder');
      if (title) await create([{ type: 'folder', title }], `Created folder “${title}”`, `Created “${title}”.`);
    };
    const newSeparator = () => create([{ type: 'separator', title: '' }], 'Added a separator', 'Added a separator.');

    // ---- Editing ----
    const properties = async (id) => {
      const n = get(id);
      if (!n || ROOT_IDS.has(id) || nodeType(n) === 'separator') return;
      const folder = isFolder(n);
      const values = await fieldsDialog(folder ? 'Folder properties' : 'Bookmark properties', [
        { name: 'title', label: 'Name', value: n.title ?? '' },
        !folder && { name: 'url', label: 'URL', value: n.url, spellcheck: 'false', validate: validUrl },
      ].filter(Boolean));
      if (values) await saveEdit(id, values);
    };
    // Saves a new name or URL; a renamed folder takes the organize rules that name it along.
    const saveEdit = async (id, values) => {
      const n = get(id);
      const folder = isFolder(n);
      const changes = {};
      if (values.title !== (n.title ?? '')) changes.title = values.title;
      if (!folder && values.url !== undefined && values.url !== n.url) changes.url = values.url;
      if (!Object.keys(changes).length) return;
      const from = pathTo(byId, id);
      const paths = folder && changes.title !== undefined ? { from, to: [...from.slice(0, -1), changes.title] } : null;
      view.active = true;
      await ctx.run(async () => {
        await ctx.actions.edit(id, changes, paths, `Edited “${values.title || values.url || n.title}”`);
        ctx.done(`Saved “${values.title || values.url || n.title}”.`);
      });
    };

    const remove = async (ids) => {
      const targets = movable(ids);
      if (!targets.length) return;
      const inside = targets.map(get).filter(isFolder).reduce((sum, f) => sum + (f.children?.length ?? 0), 0);
      if (inside && !(await confirmDialog(`Remove ${targets.length} item(s), including the folder contents (${inside} item(s) directly inside)?`, 'Remove'))) return;
      // The focus moves to the row after the last removed one, as in the Library.
      const chosen = new Set(targets);
      let first = -1;
      let last = -1;
      rows.forEach((r, i) => {
        if (!chosen.has(r.node.id)) return;
        if (first < 0) first = i;
        last = i;
      });
      const after = rows.slice(last + 1).find((r) => !within(r.node.id, chosen));
      const before = rows.slice(0, first).reverse().find((r) => !within(r.node.id, chosen));
      const next = (after ?? before)?.node.id ?? null;
      view.active = true;
      await ctx.run(async () => {
        await ctx.actions.remove(targets, `Removed ${targets.length} item(s)`);
        selectOnly(next);
        view.focus = next;
        ctx.done(`Removed ${targets.length} item(s).`);
      });
    };

    // Ignores a folder with everything inside it in every check, or stops ignoring it.
    const toggleIgnoredFolder = (folder) => ctx.run(async () => {
      if (ctx.state.whitelist[folder.id]?.inside) {
        await removeFromWhitelist([folder.id]);
        toast(`Checks include “${folder.title || '(no name)'}” again.`, 'success');
      } else {
        await addToWhitelist([{ id: folder.id, title: folder.title, inside: true }]);
        toast(`Every check now skips “${folder.title || '(no name)'}” and everything inside it.`, 'success');
      }
    });

    const sortByName = async (folderId) => {
      const f = get(folderId);
      if (!f || !isFolder(f) || !f.children?.length) return;
      view.active = true;
      await ctx.run(async () => {
        await ctx.actions.sortFolder(folderId, `Sorted “${f.title}” by name`);
        ctx.done(`Sorted “${f.title}” by name.`);
      });
    };

    // ---- Moving and copying ----
    const moveTo = async (ids, place) => {
      ids = movable(ids);
      if (!ids.length) return;
      if (!canPlace(ids, place.parentId)) return toast('A folder cannot go inside itself.', 'error');
      view.active = true;
      const dest = get(place.parentId)?.title || 'the folder';
      await ctx.run(async () => {
        await ctx.actions.moveItems(ids.map((id) => folderMove(id, place.parentId)), place.parentId, place.index, `Moved ${ids.length} item(s) to “${dest}”`);
        afterCreate(ids, place.parentId);
        ctx.done(`Moved ${ids.length} item(s) to “${dest}”.`);
      });
    };
    const copyTo = (ids, place) => create(ids.map((id) => snapshot(get(id))), `Copied ${ids.length} item(s)`, `Copied ${ids.length} item(s).`, place);

    // The clipboard keeps copies of what was copied, so pasting still works after the originals change; the
    // URLs also go to the system clipboard for pasting elsewhere.
    const toClipboard = (mode) => {
      const ids = mode === 'cut' ? movable(topSelected()) : topSelected();
      if (!ids.length) return;
      view.clipboard = { mode, ids, snaps: ids.map((id) => snapshot(get(id))), text: urlsOf(ids).join('\n') };
      if (view.clipboard.text) navigator.clipboard?.writeText(view.clipboard.text).catch(() => {});
      paint();
    };
    const paste = async (place = insertionPoint()) => {
      const clip = view.clipboard;
      if (!clip) return;
      if (clip.mode === 'cut') {
        view.clipboard = null;
        await moveTo(clip.ids, place);
      } else {
        await create(structuredClone(clip.snaps), `Pasted ${clip.snaps.length} item(s)`, `Pasted ${clip.snaps.length} item(s).`, place);
      }
    };
    // Text pasted from elsewhere becomes one bookmark per URL in it.
    const pasteText = (text) => {
      const urls = text.split(/\s+/).filter((t) => /^(https?|ftp|file):\/\/\S+$/i.test(t) && !validUrl(t));
      if (!urls.length) return false;
      create(urls.map((url) => ({ type: 'bookmark', title: url, url })), `Pasted ${urls.length} link(s)`, `Added ${urls.length} bookmark(s).`);
      return true;
    };

    const showInFolder = (id) => {
      Object.assign(view, { query: '', filter: 'all', shown: PAGE });
      search.value = '';
      filter.value = 'all';
      revealFolder(get(id).parentId);
      selectOnly(id);
      draw();
      focusRow(id);
    };

    // ---- Menus ----
    const contextMenu = (x, y) => {
      const ids = topSelected();
      const nodes = ids.map(get);
      const single = nodes.length === 1 ? nodes[0] : null;
      const urls = urlsOf(ids);
      const folder = single && isFolder(single) ? single : null;
      const sortTarget = folder ?? get(get(view.focus)?.parentId);
      const editable = single && !ROOT_IDS.has(single.id) && nodeType(single) !== 'separator';
      const onlyRoots = nodes.length > 0 && !movable(ids).length;
      showMenu(x, y, [
        urls.length > 0 && { label: urls.length > 1 ? `Open ${urls.length} in new tabs` : 'Open in new tab', key: 'Enter', run: () => open(urls, 'tab') },
        urls.length > 0 && { label: 'Open in new window', run: () => open(urls, 'window') },
        urls.length > 0 && { label: 'Open in new private window', run: () => open(urls, 'private') },
        urls.length > 0 && { label: 'Open in new container tab…', run: () => openInContainer(urls, x, y) },
        folder && { label: 'Open all in tabs', disabled: !folderUrls(folder.id).length, run: () => open(folderUrls(folder.id), 'tab') },
        searching() && single && { label: 'Show in folder', run: () => showInFolder(single.id) },
        '-',
        { label: 'New bookmark…', run: newBookmark },
        { label: 'New folder…', run: newFolder },
        { label: 'New separator', disabled: sorted(), run: newSeparator },
        { label: 'Bookmark all tabs…', run: bookmarkTabs },
        '-',
        { label: 'Undo', key: `${mod}Z`, run: () => { view.active = true; ctx.undo(); } },
        { label: 'Redo', key: `${mod}Shift+Z`, run: () => { view.active = true; ctx.redo(); } },
        '-',
        { label: 'Cut', key: `${mod}X`, disabled: !nodes.length || onlyRoots, run: () => toClipboard('cut') },
        { label: 'Copy', key: `${mod}C`, disabled: !nodes.length, run: () => toClipboard('copy') },
        { label: 'Paste', key: `${mod}V`, disabled: !view.clipboard, run: () => paste() },
        '-',
        { label: 'Delete', key: 'Del', disabled: !nodes.length || onlyRoots, run: () => remove(ids) },
        '-',
        folder && folder.id !== ROOT && { label: ctx.state.whitelist[folder.id]?.inside ? 'Stop ignoring this folder' : 'Ignore folder and everything inside', run: () => toggleIgnoredFolder(folder) },
        sortTarget && sortTarget.id !== ROOT && { label: `Sort “${sortTarget.title || '(no name)'}” by name`, disabled: !sortTarget.children?.length, run: () => sortByName(sortTarget.id) },
        { label: 'Properties…', key: 'F2', disabled: !editable, run: () => properties(single.id) },
      ], () => view.focus && rowEl(view.focus)?.focus({ preventScroll: true }));
    };

    // ---- Mouse ----
    const rowOf = (e) => e.target.closest?.('.tree-row');
    list.addEventListener('mousedown', (e) => {
      const el = rowOf(e);
      if (!el || e.button !== 0) return;
      const id = el.dataset.id;
      if (e.target.closest('.twisty') && isFolder(get(id)) && !searching()) {
        e.preventDefault();
        view.focus = id;
        setOpen(id, !view.expanded.has(id));
        focusRow(id, false);
        return;
      }
      // A plain press on an already selected row waits for the click, so several rows can be dragged together.
      if (e.ctrlKey || e.metaKey) toggleSelected(id);
      else if (e.shiftKey) selectTo(id);
      else if (!view.selected.has(id)) selectOnly(id);
      if (e.shiftKey) e.preventDefault();
      focusRow(id, false);
    });
    list.addEventListener('click', (e) => {
      const el = rowOf(e);
      if (!el || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('.twisty')) return;
      if (view.selected.size > 1 && view.selected.has(el.dataset.id)) {
        selectOnly(el.dataset.id);
        paint();
      }
    });
    list.addEventListener('dblclick', (e) => {
      const el = rowOf(e);
      if (el && !e.target.closest('.twisty')) activate(el.dataset.id);
    });
    list.addEventListener('auxclick', (e) => {
      const el = rowOf(e);
      if (!el || e.button !== 1) return;
      e.preventDefault();
      const n = get(el.dataset.id);
      // A folder opens every bookmark directly inside it, as on the bookmarks toolbar.
      if (isBookmark(n)) open([n.url], 'tab');
      else if (isFolder(n)) open(folderUrls(n.id), 'tab');
    });
    list.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const el = rowOf(e);
      if (el && !view.selected.has(el.dataset.id)) selectOnly(el.dataset.id);
      if (!el) selectOnly(null);
      if (el) focusRow(el.dataset.id, false);
      else paint();
      contextMenu(e.clientX, e.clientY);
    });
    list.addEventListener('focusin', () => { view.active = true; });
    list.addEventListener('focusout', (e) => {
      if (e.relatedTarget && !list.contains(e.relatedTarget) && !e.relatedTarget.closest('dialog')) view.active = false;
    });

    // ---- Keyboard ----
    let typed = '';
    let typedTimer;
    const step = (i, e) => {
      if (!rows.length) return;
      const id = rows[Math.max(0, Math.min(rows.length - 1, i))].node.id;
      if (e.shiftKey) selectTo(id);
      else if (!(e.ctrlKey || e.metaKey)) selectOnly(id);
      focusRow(id);
    };
    const pageSize = () => Math.max(1, Math.floor(innerHeight / (list.querySelector('.tree-row')?.offsetHeight || 28)) - 2);
    let pasteSeen = false;
    list.addEventListener('keydown', (e) => {
      if (e.target.closest('.tree-row') === null && e.target !== list) return;
      const at = indexOf(view.focus);
      const cur = get(view.focus);
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key;
      let handled = true;
      if (key === 'ArrowDown') step(at + 1, e);
      else if (key === 'ArrowUp') step(at < 0 ? 0 : at - 1, e);
      else if (key === 'Home') step(0, e);
      else if (key === 'End') step(rows.length - 1, e);
      else if (key === 'PageDown') step(at + pageSize(), e);
      else if (key === 'PageUp') step(at - pageSize(), e);
      else if (key === 'ArrowRight' && cur && isFolder(cur) && !searching()) {
        if (!view.expanded.has(cur.id)) { setOpen(cur.id, true); focusRow(cur.id); }
        else if (rows[at + 1]?.node.parentId === cur.id) step(at + 1, e);
      } else if (key === 'ArrowLeft' && cur && !searching()) {
        if (isFolder(cur) && view.expanded.has(cur.id)) { setOpen(cur.id, false); focusRow(cur.id); }
        else if (cur.parentId !== ROOT) step(indexOf(cur.parentId), e);
      } else if (key === 'Enter' && cur) {
        if (e.altKey) properties(cur.id);
        else activate(cur.id, e.shiftKey ? 'window' : ctrl ? 'tab' : undefined);
      } else if (key === ' ' && ctrl && cur) { toggleSelected(cur.id); paint(); }
      else if (key === 'F2' && cur) properties(cur.id);
      else if (key === 'Delete') remove(topSelected());
      else if ((key === 'ContextMenu' || (key === 'F10' && e.shiftKey))) {
        const r = (view.focus && rowEl(view.focus))?.getBoundingClientRect() ?? list.getBoundingClientRect();
        if (view.focus && !view.selected.has(view.focus)) { selectOnly(view.focus); paint(); }
        contextMenu(r.left + 24, r.top + r.height / 2);
      } else if (ctrl && key.toLowerCase() === 'a') selectAll();
      else if (ctrl && key.toLowerCase() === 'x') toClipboard('cut');
      else if (ctrl && key.toLowerCase() === 'c') toClipboard('copy');
      else if (ctrl && key.toLowerCase() === 'z' && !e.shiftKey) {
        view.active = true;
        ctx.undo();
      } else if (ctrl && (key.toLowerCase() === 'y' || (key.toLowerCase() === 'z' && e.shiftKey))) {
        view.active = true;
        ctx.redo();
      } else if (ctrl && key.toLowerCase() === 'v') {
        // The paste event below sees text copied elsewhere; if Firefox sends none, our own clipboard is pasted.
        pasteSeen = false;
        handled = false;
        setTimeout(() => { if (!pasteSeen) paste(); }, 50);
      } else if (key === '*' && cur && isFolder(cur) && !searching()) {
        const all = (n) => { if (isFolder(n)) { view.expanded.add(n.id); n.children?.forEach(all); } };
        all(cur);
        saveExpanded();
        draw();
        focusRow(cur.id);
      } else if (key.length === 1 && !ctrl && !e.altKey && key !== ' ') {
        // Typing jumps to the next row whose name starts with the letters typed so far.
        clearTimeout(typedTimer);
        typedTimer = setTimeout(() => { typed = ''; }, 800);
        typed += key.toLowerCase();
        const from = typed.length === 1 ? at + 1 : Math.max(at, 0);
        const order = [...rows.slice(from), ...rows.slice(0, from)];
        const hit = order.find((r) => (r.node.title || r.node.url || '').toLowerCase().startsWith(typed));
        if (hit) step(indexOf(hit.node.id), {});
      } else handled = false;
      if (handled) e.preventDefault();
    });
    list.addEventListener('paste', (e) => {
      pasteSeen = true;
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (view.clipboard && (!text || text === view.clipboard.text)) paste();
      else if (!pasteText(text) && view.clipboard) paste();
    });

    // ---- Drag and drop ----
    let dragIds = null;
    let hoverTimer;
    let hoverId = null;
    const clearDrop = () => {
      for (const el of list.querySelectorAll('.drop-before, .drop-after, .drop-into')) el.classList.remove('drop-before', 'drop-after', 'drop-into');
    };
    // Where a drop on this row would put things: before it, after it or inside it. Sorted views and search results only drop into folders.
    const dropZone = (e, el, n) => {
      const r = el.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      const folder = isFolder(n);
      if (searching() || sorted() || isRootFolder(n)) return folder ? 'into' : null;
      if (folder) return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
      return y < 0.5 ? 'before' : 'after';
    };
    const placeFor = (n, zone) => {
      if (zone === 'into') return { parentId: n.id, index: null };
      if (zone === 'before') return { parentId: n.parentId, index: n.index };
      if (isFolder(n) && view.expanded.has(n.id) && n.children?.length) return { parentId: n.id, index: 0 };
      return { parentId: n.parentId, index: n.index + 1 };
    };
    const external = (dt) => ['text/x-moz-url', 'text/uri-list'].some((t) => dt.types.includes(t));

    list.addEventListener('dragstart', (e) => {
      const el = rowOf(e);
      if (!el) return;
      if (!view.selected.has(el.dataset.id)) { selectOnly(el.dataset.id); focusRow(el.dataset.id, false); }
      const ids = movable(topSelected());
      if (!ids.length) return e.preventDefault();
      dragIds = ids;
      const marks = ids.map(get).filter(isBookmark);
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
      if (marks.length) {
        e.dataTransfer.setData('text/x-moz-url', marks.map((n) => `${n.url}\n${n.title || n.url}`).join('\n'));
        e.dataTransfer.setData('text/uri-list', marks.map((n) => n.url).join('\r\n'));
        e.dataTransfer.setData('text/plain', marks.map((n) => n.url).join('\n'));
      }
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    list.addEventListener('dragend', () => {
      dragIds = null;
      clearTimeout(hoverTimer);
      clearDrop();
    });
    list.addEventListener('dragover', (e) => {
      const el = rowOf(e);
      clearDrop();
      if (!el || !(dragIds || external(e.dataTransfer))) return;
      const n = get(el.dataset.id);
      const zone = dropZone(e, el, n);
      if (!zone) return;
      const place = placeFor(n, zone);
      if (dragIds && !canPlace(dragIds, place.parentId)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = !dragIds || e.ctrlKey || e.metaKey ? 'copy' : 'move';
      el.classList.add(`drop-${zone}`);
      // Holding over a closed folder opens it.
      if (zone === 'into' && !searching() && !view.expanded.has(n.id)) {
        if (hoverId !== n.id) {
          hoverId = n.id;
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => setOpen(n.id, true), 800);
        }
      } else {
        hoverId = null;
        clearTimeout(hoverTimer);
      }
    });
    list.addEventListener('dragleave', (e) => {
      if (!list.contains(e.relatedTarget)) {
        clearDrop();
        hoverId = null;
        clearTimeout(hoverTimer);
      }
    });
    list.addEventListener('drop', (e) => {
      const el = rowOf(e);
      clearDrop();
      clearTimeout(hoverTimer);
      if (!el) return;
      e.preventDefault();
      const n = get(el.dataset.id);
      const zone = dropZone(e, el, n);
      if (!zone) return;
      const place = placeFor(n, zone);
      const ids = dragIds;
      dragIds = null;
      if (ids) {
        if (!canPlace(ids, place.parentId)) return;
        if (e.ctrlKey || e.metaKey) copyTo(ids, place);
        else moveTo(ids, place);
        return;
      }
      // Links dragged in from a page, a tab or the address bar become new bookmarks.
      const moz = e.dataTransfer.getData('text/x-moz-url');
      const pairs = [];
      if (moz) {
        const lines = moz.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 2) if (lines[i]) pairs.push({ url: lines[i], title: lines[i + 1] || lines[i] });
      } else {
        for (const line of e.dataTransfer.getData('text/uri-list').split(/\r?\n/)) if (line && !line.startsWith('#')) pairs.push({ url: line, title: line });
      }
      const good = pairs.filter((p) => !validUrl(p.url));
      if (good.length) create(good.map((p) => ({ type: 'bookmark', ...p })), `Added ${good.length} dropped link(s)`, `Added ${good.length} bookmark(s).`, place);
    });

    // ---- Import and export ----
    const exportHtml = () => {
      downloadFile(toBookmarkHtml(root.children), `bookmarks-${new Date().toISOString().slice(0, 10)}.html`, 'text/html');
    };
    const fileInput = h('input', { type: 'file', accept: '.html,.htm,text/html', hidden: true, onchange: async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      const snaps = parseBookmarkHtml(await file.text());
      const count = countBookmarks(snaps);
      if (!count) return toast('No bookmarks found in that file.', 'error');
      const title = `Imported ${new Date().toLocaleDateString()}`;
      if (!(await confirmDialog(`Import ${count} bookmark(s) into a new folder “${title}” in Other Bookmarks?`, 'Import', false))) return;
      await create([{ type: 'folder', title, children: snaps }], `Imported ${count} bookmark(s)`, `Imported ${count} bookmark(s) into “${title}”.`, { parentId: OTHER, index: null });
    } });
    const backupInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => {
      const file = backupInput.files[0];
      backupInput.value = '';
      if (file) restoreBackup(ctx, file);
    } });
    const backupMenu = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      showMenu(r.left, r.bottom + 2, [
        { label: 'Export bookmarks to HTML…', run: exportHtml },
        { label: 'Import bookmarks from HTML…', run: () => fileInput.click() },
        '-',
        { label: 'Back up to JSON…', run: backupJson },
        { label: 'Restore from JSON backup…', run: () => backupInput.click() },
      ]);
    };
    const columnsMenu = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const toggle = async (key) => {
        const on = !view.columns[key];
        if (on && (key === 'visited' || key === 'visits') && !(await ask('history'))) return toast('Visit columns need permission to read your browsing history.', 'error');
        view.columns[key] = on;
        if (!on && view.sort.key === COLUMNS.find((c) => c.key === key).sort) view.sort = { key: null, dir: 1 };
        saveColumns();
        if (showsVisits()) loadVisits().then(() => draw());
        draw();
      };
      showMenu(r.left, r.bottom + 2, COLUMNS.filter((c) => c.key !== 'where').map((c) => ({ label: c.label, checked: view.columns[c.key], run: () => toggle(c.key) })));
    };
    const organizeMenu = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      contextMenu(r.left, r.bottom + 2);
    };

    // ---- Toolbar ----
    const search = h('input', {
      type: 'search', value: view.query, placeholder: 'Search name, URL or folder', 'aria-label': 'Search bookmarks',
      oninput: () => { view.query = search.value; view.shown = PAGE; draw(); },
      onkeydown: (e) => {
        if (e.key === 'ArrowDown' && rows.length) {
          e.preventDefault();
          if (!view.focus || indexOf(view.focus) < 0) selectOnly(rows[0].node.id);
          focusRow(view.focus ?? rows[0].node.id);
        }
      },
    });
    const filter = h('select', { 'aria-label': 'Show', onchange: () => { view.filter = filter.value; view.shown = PAGE; draw(); } },
      h('option', { value: 'all', text: 'All', selected: view.filter === 'all' }),
      h('option', { value: 'dupes', text: 'Only duplicates', selected: view.filter === 'dupes' }),
      h('option', { value: 'unique', text: 'Only non-duplicates', selected: view.filter === 'unique' }),
      h('option', { value: 'recent', text: 'Recently added', selected: view.filter === 'recent' }));

    const toolbar = h('div', { class: 'row wrap tree-toolbar' },
      h('button', { class: 'small', text: 'Organize ▾', title: 'The same actions as the right-click menu', onclick: organizeMenu }),
      h('button', { class: 'small', text: 'Columns ▾', title: 'Choose which columns to show', onclick: columnsMenu }),
      h('button', { class: 'small', text: 'Import and backup ▾', onclick: backupMenu }),
      h('button', { class: 'small', text: 'Expand all', onclick: () => setAllOpen(true), title: 'Open every folder' }),
      h('button', { class: 'small', text: 'Collapse all', onclick: () => setAllOpen(false), title: 'Close every folder' }),
      fileInput, backupInput);

    // ---- Details pane ----
    // Edits the selected item in place, as the Library's bottom pane does; Enter or leaving a field saves.
    let detailsFor;
    const details = h('aside', { class: 'details-pane', 'aria-label': 'Details' });
    function drawDetails() {
      const ids = [...view.selected];
      const n = ids.length === 1 ? get(ids[0]) : null;
      const key = n ? `${n.id}:${visits.at}` : `none:${ids.length}`;
      if (key === detailsFor) return;
      detailsFor = key;
      if (!n) {
        details.replaceChildren(h('p', { class: 'muted small', text: ids.length ? `${ids.length} items selected.` : 'Select a bookmark or folder to see and edit its details.' }));
        return;
      }
      const type = nodeType(n);
      const visit = visitOf(n);
      const meta = h('p', { class: 'muted small details-meta' },
        h('span', { text: formatPath(info.get(n.id)?.path ?? []) }),
        type !== 'separator' && n.dateAdded ? h('span', { text: `Added ${formatDate(n.dateAdded)}` }) : null,
        type === 'bookmark' && visits.map ? h('span', { text: visit ? `Last visited ${formatDate(visit.last)} · ${visit.count} visit(s)` : 'Never visited' }) : null);
      if (type === 'separator' || ROOT_IDS.has(n.id)) {
        details.replaceChildren(h('p', { class: 'details-title', text: type === 'separator' ? 'Separator' : n.title }), meta);
        return;
      }
      const title = h('input', { type: 'text', value: n.title ?? '', 'aria-label': 'Name' });
      const url = type === 'bookmark' ? h('input', { type: 'text', value: n.url, spellcheck: 'false', 'aria-label': 'URL' }) : null;
      const error = h('p', { class: 'error small', hidden: true });
      // Enter fires both change and submit, so the same values are only saved once.
      let saved = '';
      const save = (e) => {
        e?.preventDefault();
        const values = { title: title.value.trim(), ...(url ? { url: url.value.trim() } : {}) };
        if (JSON.stringify(values) === saved) return;
        const bad = url && validUrl(values.url);
        error.hidden = !bad;
        error.textContent = bad ?? '';
        if (bad) return;
        saved = JSON.stringify(values);
        saveEdit(n.id, values);
      };
      const reset = (e) => {
        if (e.key !== 'Escape') return;
        title.value = n.title ?? '';
        if (url) url.value = n.url;
        error.hidden = true;
      };
      details.replaceChildren(h('form', { class: 'details-form', onsubmit: save, onchange: save, onkeydown: reset },
        h('label', {}, h('span', { text: 'Name' }), title),
        url && h('label', {}, h('span', { text: 'URL' }), url),
        h('button', { type: 'submit', hidden: true, tabindex: '-1' }),
        error, meta));
    }

    if (showsVisits() && !visits.loading && (!visits.map || Date.now() - visits.at > VISITS_MAX_AGE)) loadVisits().then(() => draw());
    draw();
    if (view.active && view.focus) requestAnimationFrame(() => focusRow(view.focus));
    else if (view.focus) requestAnimationFrame(() => rowEl(view.focus)?.scrollIntoView({ block: 'nearest' }));

    return h('section', { class: 'library' },
      viewHeader('All bookmarks', 'Your bookmarks as a tree: right-click for actions, drag to move, Ctrl-drag to copy'),
      h('div', { class: 'row wrap filters' }, search, filter),
      toolbar,
      status,
      wrap,
      more,
      details);
  },
};
