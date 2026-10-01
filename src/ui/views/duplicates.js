// Duplicate bookmarks grouped by URL, with bulk selection helpers and remove or move-to-folder actions.

import { h } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectionBar, bookmarkInfo, row, pagedList, ignoreAction, removeAction } from '../components.js';
import * as scans from '../scans.js';

export default {
  id: 'duplicates',
  label: 'Duplicates',
  badge: (ctx) => scans.duplicates(ctx).groups.length,

  render(ctx) {
    const { groups, errors, extra } = scans.duplicates(ctx);
    const all = groups.flatMap((g) => g.items);
    const sel = ctx.selection('duplicates', all.map((b) => b.id));
    const pick = (fn) => { sel.clear(); sel.set(groups.flatMap((g) => g.items.filter((i) => fn(i, g)).map((i) => i.id)), true); };
    const folder = ctx.state.settings.dupesFolderName;

    const header = viewHeader('Duplicates', 'Bookmarks that point to the same URL',
      h('button', { class: 'small', text: 'Matching options…', onclick: () => ctx.go('settings') }));
    header.append(h('p', { class: 'muted', text: `${groups.length} URL(s) bookmarked more than once, ${extra} extra cop${extra === 1 ? 'y' : 'ies'}.` }));
    if (errors.length) {
      header.append(h('p', { class: 'error', text: `${errors.length} custom rule(s) are invalid and were skipped — see Settings.` }));
    }
    if (!groups.length) return h('section', {}, header, emptyState('No duplicates found.'));

    // Removing every copy of a URL loses it altogether, which the confirmation points out.
    const wholeGroups = (ids) => {
      const chosen = new Set(ids);
      const gone = groups.filter((g) => g.items.every((i) => chosen.has(i.id))).length;
      return gone ? ` ${gone} group(s) would lose every copy.` : '';
    };
    const bar = selectionBar(sel, [
      { label: `Move to “${folder}”`, title: `Move to a “${folder}” folder in Other Bookmarks`, run: (ids) => ctx.run(async () => {
        await ctx.actions.moveToFolder(ids, folder);
        ctx.done(`Moved ${ids.length} bookmark(s) to “${folder}”.`);
      }) },
      ignoreAction(ctx, all),
      removeAction(ctx, {
        ask: (ids) => `Remove ${ids.length} bookmark(s)?${wholeGroups(ids)} You can undo this from the history.`,
        label: (ids) => `Removed ${ids.length} duplicate bookmark(s)`,
        done: (ids) => `Removed ${ids.length} duplicate(s).`,
      }),
    ], [
      h('button', { class: 'small', text: 'All but oldest', title: 'Select every copy except the first one added', onclick: () => pick((i) => i.order > 1) }),
      h('button', { class: 'small', text: 'All but newest', title: 'Select every copy except the last one added', onclick: () => pick((i, g) => i.order < g.items.length) }),
      h('button', { class: 'small', text: 'Clear', onclick: () => sel.clear() }),
    ]);

    const list = h('div', { class: 'groups' });
    const more = pagedList('duplicates', list, groups, (g) => h('section', { class: 'group' },
      h('h2', { class: 'group-title', text: g.key, title: 'Comparison key' }),
      h('ul', { class: 'items' }, g.items.map((b) => row(sel, b.id,
        h('div', { class: 'row top grow' }, h('span', { class: 'order', text: b.order, title: `Added ${b.order === 1 ? 'first' : `#${b.order}`}` }), bookmarkInfo(b, ctx)))))));
    bindCheckboxes(list, sel);
    return h('section', {}, header, bar, list, more);
  },
};
