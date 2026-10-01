// Folders with no bookmarks anywhere inside them.

import { h } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectionBar, selectAllToggle, row, pagedList, ignoreAction, removeAction } from '../components.js';
import { formatPath } from '../../lib/tree.js';
import * as scans from '../scans.js';

export default {
  id: 'empty-folders',
  label: 'Empty folders',
  badge: (ctx) => scans.emptyFolders(ctx).length,

  render(ctx) {
    const folders = scans.emptyFolders(ctx);
    const sel = ctx.selection('empty-folders', folders.map((f) => f.id));
    const header = viewHeader('Empty folders', 'Folders with no bookmarks anywhere inside');
    if (!folders.length) return h('section', {}, header, emptyState('No empty folders.'));

    const bar = selectionBar(sel, [
      ignoreAction(ctx, folders),
      removeAction(ctx, { noun: 'empty folder(s)' }),
    ], [selectAllToggle(sel, folders.map((f) => f.id))]);

    const list = h('ul', { class: 'items' });
    const more = pagedList('empty-folders', list, folders, (f) => row(sel, f.id, h('div', { class: 'bm' },
      h('div', { class: 'bm-title' }, h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), h('span', { text: f.title || '(no name)' })),
      h('div', { class: 'bm-meta muted' }, h('span', { text: formatPath(f.path) }), f.subfolders ? h('span', { text: `${f.subfolders} empty subfolder(s)` }) : null))));
    bindCheckboxes(list, sel);
    return h('section', {}, header, bar, list, more);
  },
};
