// What the tree shows: the rows on screen, drawing them, and keeping the selection painted on them.

import { h } from '../../dom.js';
import { ROOT, ROOT_IDS, MOBILE, nodeType, isFolder, formatPath } from '../../../lib/tree.js';
import { matchesSearch } from '../../../lib/library.js';
import { view, searching, sorted } from './state.js';
import { shownColumns, sortButton, sortOrder } from './columns.js';
import * as scans from '../../scans.js';

export function rowsOf(lib) {
  const { ctx, root, get, info, list, head, wrap, status, more } = lib;

  // A folder's children as shown: the empty Mobile folder is left out, and a sorted view drops separators.
  const displayChildren = (folder) => {
    let kids = folder.children ?? [];
    if (folder.id === ROOT) kids = kids.filter((c) => c.id !== MOBILE || c.children?.length);
    if (!sorted()) return kids;
    return kids.filter((c) => nodeType(c) !== 'separator').sort(sortOrder());
  };
  const dupeIds = () => new Set(scans.duplicates(ctx).groups.flatMap((g) => g.items.map((i) => i.id)));

  // Search results as a flat list limited to the rows shown so far, or the open folders as a tree.
  const computeRows = () => {
    if (!searching()) {
      const out = [];
      const walk = (folder, level) => {
        for (const c of displayChildren(folder)) {
          out.push({ node: c, level });
          if (isFolder(c) && view.expanded.has(c.id)) walk(c, level + 1);
        }
      };
      walk(root, 0);
      return { rows: out, total: out.length };
    }
    const query = view.query.trim().toLowerCase();
    const recent = view.filter === 'recent';
    const dupes = view.filter === 'dupes' || view.filter === 'unique' ? dupeIds() : null;
    let hits = ctx.state.flat.filter((f) => matchesSearch(f, { query, filter: view.filter, dupeIds: dupes })).map((f) => get(f.id));
    if (sorted()) hits = hits.sort(sortOrder());
    else if (recent) hits = hits.sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0));
    return { rows: hits.slice(0, view.shown).map((n) => ({ node: n, level: 0 })), total: hits.length };
  };

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
    Object.assign(lib, computeRows());
    list.classList.toggle('searching', searching());
    wrap.style.setProperty('--cols', ['minmax(14em, 3fr)', ...shownColumns().map((c) => c.width)].join(' '));
    head.replaceChildren(sortButton('title', 'Name', draw), ...shownColumns().map((c) => (c.sort ? sortButton(c.sort, c.label, draw) : h('span', { class: 'col-plain', text: c.label }))));
    list.replaceChildren(...lib.rows.map(row));
    if (!lib.rows.length) list.append(h('li', { class: 'tree-empty muted', text: searching() ? 'Nothing matches.' : 'No bookmarks.' }));
    more.hidden = !searching() || lib.total <= view.shown;
    paint();
  };

  // Marks the selected, cut and focused rows and updates the status line.
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
    const counts = searching() ? `${lib.total} found` : `${lib.bookmarkCount} bookmarks in ${lib.folderCount} folders`;
    status.textContent = n ? `${counts} · ${n} selected` : counts;
    lib.drawDetails();
  };

  const rowEl = (id) => list.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const indexOf = (id) => lib.rows.findIndex((r) => r.node.id === id);

  const focusRow = (id, scroll = true) => {
    view.focus = id;
    paint();
    const el = id && rowEl(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (scroll) el.scrollIntoView({ block: 'nearest' });
  };

  return { draw, paint, rowEl, indexOf, focusRow };
}
