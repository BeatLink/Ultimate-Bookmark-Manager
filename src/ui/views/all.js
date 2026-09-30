// Every bookmark, searchable and filterable to only duplicates or only unique ones.

import { h, Selection, confirmDialog } from '../dom.js';
import { viewHeader, bindCheckboxes, selectionBar, bookmarkInfo, row } from '../components.js';
import { formatPath } from '../../lib/tree.js';
import * as scans from '../scans.js';

const PAGE = 200;

export default {
  id: 'all',
  label: 'All bookmarks',

  render(ctx) {
    const bookmarks = ctx.state.flat.filter((b) => b.type === 'bookmark');
    const dupeIds = new Set(scans.duplicates(ctx).groups.flatMap((g) => g.items.map((i) => i.id)));
    const sel = new Selection();
    let shown = PAGE;

    const search = h('input', { type: 'search', placeholder: 'Search name, address or folder', 'aria-label': 'Search', oninput: () => { shown = PAGE; draw(); } });
    const filter = h('select', { 'aria-label': 'Show', onchange: () => { shown = PAGE; draw(); } },
      h('option', { value: 'all', text: 'All' }),
      h('option', { value: 'dupes', text: 'Only duplicates' }),
      h('option', { value: 'unique', text: 'Only non-duplicates' }));
    const count = h('p', { class: 'muted' });
    const list = h('ul', { class: 'items' });
    const more = h('button', { text: 'Show more', onclick: () => { shown += PAGE; draw(); } });

    const matches = () => {
      const q = search.value.trim().toLowerCase();
      return bookmarks.filter((b) => {
        if (filter.value === 'dupes' && !dupeIds.has(b.id)) return false;
        if (filter.value === 'unique' && dupeIds.has(b.id)) return false;
        return !q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q) || formatPath(b.path).toLowerCase().includes(q);
      });
    };
    const draw = () => {
      const found = matches();
      count.textContent = `${found.length} of ${bookmarks.length} bookmarks`;
      list.replaceChildren(...found.slice(0, shown).map((b) => row(sel, b.id, bookmarkInfo(b, ctx))));
      more.hidden = found.length <= shown;
    };

    const bar = selectionBar(sel, [
      { label: 'Remove selected', danger: true, run: async (ids) => {
        if (!(await confirmDialog(`Remove ${ids.length} bookmark(s)?`, 'Remove'))) return;
        await ctx.run(async () => {
          await ctx.actions.remove(ids);
          ctx.done(`Removed ${ids.length} bookmark(s).`);
        });
      } },
    ], [h('button', { class: 'small', text: 'Select shown', onclick: () => sel.set(matches().slice(0, shown).map((b) => b.id), true) }),
      h('button', { class: 'small', text: 'Clear', onclick: () => sel.clear() })]);

    bindCheckboxes(list, sel);
    draw();
    return h('section', {}, viewHeader('All bookmarks', null), h('div', { class: 'row wrap filters' }, search, filter), count, bar, list, more);
  },
};
