// Sibling folders sharing a name, which can be merged into the first of them.

import { h, confirmDialog } from '../dom.js';
import { viewHeader, emptyState } from '../components.js';
import { addToWhitelist } from '../../lib/settings.js';
import { formatPath } from '../../lib/tree.js';
import * as scans from '../scans.js';

export default {
  id: 'same-name',
  label: 'Same-name folders',
  badge: (ctx) => scans.sameNameFolders(ctx).length,

  render(ctx) {
    const groups = scans.sameNameFolders(ctx);
    const merge = async (list) => {
      const n = list.reduce((sum, g) => sum + g.folders.length - 1, 0);
      if (!(await confirmDialog(`Merge ${n} folder(s) into their first same-name sibling? Their contents are moved and the emptied folders removed.`, 'Merge', false))) return;
      await ctx.run(async () => {
        await ctx.actions.mergeFolders(list);
        ctx.done(`Merged ${n} folder(s). Rescan: merged folders can now contain same-name subfolders.`);
      });
    };
    const header = viewHeader('Same-name folders', 'Folders in the same place with the same name. Merging keeps the first one and moves the others’ contents into it.',
      groups.length > 0 && h('button', { class: 'primary', text: `Merge all (${groups.length})`, onclick: () => merge(groups) }));
    if (!groups.length) return h('section', {}, header, emptyState('No same-name folders.'));

    return h('section', {}, header, h('ul', { class: 'items' }, groups.map((g) => h('li', { class: 'item' },
      h('div', { class: 'bm' },
        h('div', { class: 'bm-title' }, h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), h('span', { text: g.title || '(no name)' }), h('span', { class: 'muted', text: ` × ${g.folders.length}` })),
        h('div', { class: 'bm-meta muted' }, h('span', { text: `In ${formatPath(g.path)}` }), h('span', { text: `Items: ${g.folders.map((f) => f.size).join(' + ')}` }))),
      h('div', { class: 'item-actions' },
        h('button', { class: 'small', text: 'Ignore', onclick: () => ctx.run(() => addToWhitelist(g.folders)) }),
        h('button', { class: 'small primary', text: 'Merge', onclick: () => merge([g]) })),
    ))));
  },
};
