// Duplicate bookmarks grouped by URL, with bulk selection helpers and remove or move-to-folder actions.

import { h, confirmDialog } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectionBar, bookmarkInfo, row } from '../components.js';
import { addToWhitelist } from '../../lib/settings.js';
import * as scans from '../scans.js';

export default {
  id: 'duplicates',
  label: 'Duplicates',
  badge: (ctx) => scans.duplicates(ctx).groups.length,

  render(ctx) {
    const { groups, errors } = scans.duplicates(ctx);
    const all = groups.flatMap((g) => g.items);
    const sel = ctx.selection('duplicates', all.map((b) => b.id));
    const pick = (fn) => { sel.clear(); sel.set(groups.flatMap((g) => g.items.filter((i) => fn(i, g)).map((i) => i.id)), true); };
    const folder = ctx.state.settings.dupesFolderName;

    const header = viewHeader('Duplicates',
      `${groups.length} URL(s) bookmarked more than once, ${all.length - groups.length} extra cop${all.length - groups.length === 1 ? 'y' : 'ies'}. Numbers show the order they were added (1 = oldest).`,
      h('button', { class: 'small', text: 'Matching options…', onclick: () => ctx.go('settings') }));
    if (errors.length) {
      header.append(h('p', { class: 'error', text: `${errors.length} custom rule(s) are invalid and were skipped — see Settings.` }));
    }
    if (!groups.length) return h('section', {}, header, emptyState('No duplicates found.'));

    const bar = selectionBar(sel, [
      { label: `Move to “${folder}”`, title: `Move to a “${folder}” folder in Other Bookmarks`, run: (ids) => ctx.run(async () => {
        await ctx.actions.moveToFolder(ids, folder);
        ctx.done(`Moved ${ids.length} bookmark(s) to “${folder}”.`);
      }) },
      { label: 'Ignore', title: 'Add to the whitelist so they are skipped by every check', run: (ids) => ctx.run(async () => {
        await addToWhitelist(all.filter((b) => ids.includes(b.id)));
      }) },
      { label: 'Remove selected', danger: true, run: async (ids) => {
        const wholeGroups = groups.filter((g) => g.items.every((i) => ids.includes(i.id))).length;
        const warn = wholeGroups ? ` ${wholeGroups} group(s) would lose every copy.` : '';
        if (!(await confirmDialog(`Remove ${ids.length} bookmark(s)?${warn} You can undo this from the history.`, 'Remove'))) return;
        await ctx.run(async () => {
          await ctx.actions.remove(ids, `Removed ${ids.length} duplicate bookmark(s)`);
          ctx.done(`Removed ${ids.length} duplicate(s).`);
        });
      } },
    ], [
      h('button', { class: 'small', text: 'All but oldest', title: 'Select every copy except the first one added', onclick: () => pick((i) => i.order > 1) }),
      h('button', { class: 'small', text: 'All but newest', title: 'Select every copy except the last one added', onclick: () => pick((i, g) => i.order < g.items.length) }),
      h('button', { class: 'small', text: 'Clear', onclick: () => sel.clear() }),
    ]);

    const list = h('div', { class: 'groups' }, groups.map((g) => h('section', { class: 'group' },
      h('h2', { class: 'group-title', text: g.key, title: 'Comparison key' }),
      h('ul', { class: 'items' }, g.items.map((b) => row(sel, b.id,
        h('div', { class: 'row top grow' }, h('span', { class: 'order', text: b.order, title: `Added ${b.order === 1 ? 'first' : `#${b.order}`}` }), bookmarkInfo(b, ctx)))))),
    ));
    bindCheckboxes(list, sel);
    return h('section', {}, header, bar, list);
  },
};
