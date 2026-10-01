// Bookmarks whose URL failed to load, grouped by kind of failure.

import { h } from '../dom.js';
import { emptyState, bindCheckboxes, selectionBar, selectAllToggle, bookmarkInfo, row, pagedList, ignoreAction, removeAction } from '../components.js';
import { checkControls } from '../link-checker.js';
import { CATEGORIES } from '../../lib/linkcheck.js';
import { groupBy } from '../../lib/group.js';
import * as scans from '../scans.js';

export default {
  id: 'broken',
  label: 'Broken links',
  badge: (ctx) => scans.broken(ctx)?.length,

  render(ctx) {
    const header = checkControls(ctx, 'Broken links', 'Bookmarks whose page did not load');
    const items = scans.broken(ctx);
    if (!items) return h('section', {}, header);
    if (!items.length) return h('section', {}, header, emptyState('No broken links found.'));

    const sel = ctx.selection('broken', items.map((b) => b.id));
    const bar = selectionBar(sel, [
      { label: 'Check again', title: 'Re-check just the selected bookmarks', run: (ids) => ctx.linkChecker.start(ids) },
      ignoreAction(ctx, items),
      removeAction(ctx, { ask: (ids) => `Remove ${ids.length} bookmark(s)?`, label: (ids) => `Removed ${ids.length} broken bookmark(s)`, done: (ids) => `Removed ${ids.length} bookmark(s).` }),
    ], [selectAllToggle(sel, items.map((b) => b.id))]);

    const byCategory = groupBy(items, (r) => r.category);
    // Each kind of failure lists its first rows, with the rest a "Show more" away.
    const groupRows = (key, group) => {
      const ul = h('ul', { class: 'items' });
      const more = pagedList(`broken:${key}`, ul, group, (b) => row(sel, b.id, bookmarkInfo(b, ctx, {
        meta: h('span', { class: 'status', text: [b.httpStatus, b.detail].filter(Boolean).join(' ') || CATEGORIES[b.category].label }),
      })));
      return [ul, more];
    };
    const list = h('div', { class: 'groups' }, Object.keys(CATEGORIES).filter((key) => byCategory.has(key)).map((key) => h('section', { class: 'group' },
      h('h2', { class: `group-title sticky ${CATEGORIES[key].severity}` },
        h('span', { text: `${CATEGORIES[key].label} — ${byCategory.get(key).length}` }),
        selectAllToggle(sel, byCategory.get(key).map((b) => b.id), 'Select group')),
      groupRows(key, byCategory.get(key)))));
    bindCheckboxes(list, sel);
    return h('section', {}, header, bar, list);
  },
};
