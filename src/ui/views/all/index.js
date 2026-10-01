// Every bookmark as a folder tree, managed like Firefox's Library; its parts share one `lib` object holding the loaded tree, the rows on screen and each other's functions.

import { h } from '../../dom.js';
import { viewHeader, PAGE } from '../../components.js';
import { bookmarksOnly } from '../../../lib/tree.js';
import { view, setSearch } from './state.js';
import { visitsStale, loadVisits } from './visits.js';
import { showsVisits, columnsMenu } from './columns.js';
import { rowsOf } from './rows.js';
import { selectionOf } from './selection.js';
import { foldersOf } from './folders.js';
import { commandsOf } from './commands.js';
import { menusOf } from './menus.js';
import { wireInput } from './input.js';
import { wireDragDrop } from './dnd.js';
import { transferOf } from './transfer.js';
import { detailsOf } from './details.js';

export default {
  id: 'all',
  label: 'All bookmarks',

  render(ctx) {
    const root = ctx.state.root;
    const byId = new Map();
    const index = (n) => { byId.set(n.id, n); n.children?.forEach(index); };
    index(root);

    // The selection, focus and cut items forget anything removed since the last render.
    for (const id of view.selected) if (!byId.has(id)) view.selected.delete(id);
    if (view.focus && !byId.has(view.focus)) view.focus = null;
    if (view.clipboard?.mode === 'cut') view.clipboard.ids = view.clipboard.ids.filter((id) => byId.has(id));

    const list = h('ul', { class: 'bm-tree', role: 'tree', 'aria-label': 'Bookmarks', 'aria-multiselectable': 'true' });
    const head = h('div', { class: 'bm-tree-head', role: 'presentation' });
    const lib = {
      ctx, root, byId, get: (id) => byId.get(id),
      info: new Map(ctx.state.flat.map((f) => [f.id, f])),
      bookmarkCount: bookmarksOnly(ctx.state.flat).length,
      folderCount: ctx.state.flat.filter((b) => b.type === 'folder').length,
      // The rows on screen and, when searching, how many matched in all; `draw` fills them in.
      rows: [], total: 0,
      list, head,
      wrap: h('div', { class: 'bm-tree-wrap' }, head, list),
      status: h('p', { class: 'muted small tree-status' }),
      more: h('button', { text: 'Show more', onclick: () => { view.shown += PAGE; lib.draw(); } }),
      details: h('aside', { class: 'details-pane', 'aria-label': 'Details' }),
      search: h('input', {
        type: 'search', value: view.query, placeholder: 'Search name, URL or folder', 'aria-label': 'Search bookmarks',
        oninput: () => { setSearch(lib.search.value, lib.filter.value); lib.draw(); },
        onkeydown: (e) => {
          if (e.key === 'ArrowDown' && lib.rows.length) {
            e.preventDefault();
            if (!view.focus || lib.indexOf(view.focus) < 0) lib.selectOnly(lib.rows[0].node.id);
            lib.focusRow(view.focus ?? lib.rows[0].node.id);
          }
        },
      }),
      filter: h('select', { 'aria-label': 'Show', onchange: () => { setSearch(lib.search.value, lib.filter.value); lib.draw(); } },
        h('option', { value: 'all', text: 'All', selected: view.filter === 'all' }),
        h('option', { value: 'dupes', text: 'Only duplicates', selected: view.filter === 'dupes' }),
        h('option', { value: 'unique', text: 'Only non-duplicates', selected: view.filter === 'unique' }),
        h('option', { value: 'recent', text: 'Recently added', selected: view.filter === 'recent' })),
    };
    Object.assign(lib, rowsOf(lib), selectionOf(lib), foldersOf(lib), commandsOf(lib), menusOf(lib), detailsOf(lib), transferOf(lib));
    wireInput(lib);
    wireDragDrop(lib);

    const toolbar = h('div', { class: 'row wrap tree-toolbar' },
      h('button', { class: 'small', text: 'Organize ▾', title: 'The same actions as the right-click menu', onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        lib.contextMenu(r.left, r.bottom + 2);
      } }),
      h('button', { class: 'small', text: 'Columns ▾', title: 'Choose which columns to show', onclick: (e) => columnsMenu(e.currentTarget, lib.draw) }),
      h('button', { class: 'small', text: 'Import and backup ▾', onclick: lib.backupMenu }),
      h('button', { class: 'small', text: 'Expand all', onclick: () => lib.setAllOpen(true), title: 'Open every folder' }),
      h('button', { class: 'small', text: 'Collapse all', onclick: () => lib.setAllOpen(false), title: 'Close every folder' }),
      lib.fileInputs);

    if (showsVisits() && visitsStale()) loadVisits().then(lib.draw);
    lib.draw();
    if (view.active && view.focus) requestAnimationFrame(() => lib.focusRow(view.focus));
    else if (view.focus) requestAnimationFrame(() => lib.rowEl(view.focus)?.scrollIntoView({ block: 'nearest' }));

    return h('section', { class: 'library' },
      viewHeader('All bookmarks', 'Your bookmarks as a tree: right-click for actions, drag to move, Ctrl-drag to copy'),
      h('div', { class: 'row wrap filters' }, lib.search, lib.filter),
      toolbar,
      lib.status,
      lib.wrap,
      lib.more,
      lib.details);
  },
};
