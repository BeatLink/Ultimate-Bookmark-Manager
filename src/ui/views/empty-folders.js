// Folders with no bookmarks anywhere inside them.

import { h, confirmDialog } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectionBar, selectAllToggle, row } from '../components.js';
import { addToWhitelist } from '../../lib/settings.js';
import { formatPath } from '../../lib/tree.js';
import * as scans from '../scans.js';

export default {
  id: 'empty-folders',
  label: 'Empty folders',
  badge: (ctx) => scans.emptyFolders(ctx).length,

  render(ctx) {
    const folders = scans.emptyFolders(ctx);
    const sel = ctx.selection('empty-folders', folders.map((f) => f.id));
    const header = viewHeader('Empty folders', 'Folders that contain no bookmarks, only empty subfolders or separators. Removing one removes what is inside it.');
    if (!folders.length) return h('section', {}, header, emptyState('No empty folders.'));

    const bar = selectionBar(sel, [
      { label: 'Ignore', run: (ids) => ctx.run(() => addToWhitelist(folders.filter((f) => ids.includes(f.id)))) },
      { label: 'Remove selected', danger: true, run: async (ids) => {
        if (!(await confirmDialog(`Remove ${ids.length} empty folder(s)?`, 'Remove'))) return;
        await ctx.run(async () => {
          await ctx.actions.remove(ids, `Removed ${ids.length} empty folder(s)`);
          ctx.done(`Removed ${ids.length} folder(s).`);
        });
      } },
    ], [selectAllToggle(sel, folders.map((f) => f.id))]);

    const list = h('ul', { class: 'items' }, folders.map((f) => row(sel, f.id, h('div', { class: 'bm' },
      h('div', { class: 'bm-title' }, h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), h('span', { text: f.title || '(no name)' })),
      h('div', { class: 'bm-meta muted' }, h('span', { text: formatPath(f.path) }), f.subfolders ? h('span', { text: `${f.subfolders} empty subfolder(s)` }) : null)))));
    bindCheckboxes(list, sel);
    return h('section', {}, header, bar, list);
  },
};
