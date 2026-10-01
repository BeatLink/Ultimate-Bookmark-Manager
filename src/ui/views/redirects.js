// Bookmarks whose URL now redirects elsewhere, with one-click correction to the final URL.

import { h } from '../dom.js';
import { emptyState, bindCheckboxes, selectionBar, selectAllToggle, bookmarkInfo, row, pagedList, pickIds, ignoreAction } from '../components.js';
import { checkControls } from '../link-checker.js';
import { siteOf } from '../../lib/stats.js';
import * as scans from '../scans.js';

export default {
  id: 'redirects',
  label: 'Redirects',
  badge: (ctx) => scans.redirects(ctx)?.length,

  render(ctx) {
    const header = checkControls(ctx, 'Redirects', 'Bookmarks whose URL now leads somewhere else');
    const items = scans.redirects(ctx);
    if (!items) return h('section', {}, header);
    if (!items.length) return h('section', {}, header, emptyState('No redirects found.'));

    // A redirect to another site may be an expired domain sold on, not the page that moved, so it is flagged.
    const elsewhere = new Set(items.filter((b) => siteOf(b.url) !== siteOf(b.finalUrl)).map((b) => b.id));
    const fix = (ids) => ctx.run(async () => {
      const changes = pickIds(items, ids).map((b) => ({ id: b.id, url: b.finalUrl }));
      await ctx.actions.update(changes, `Updated ${changes.length} redirected URL(s)`);
      ctx.done(`Updated ${changes.length} URL(s).`);
    });
    const sel = ctx.selection('redirects', items.map((b) => b.id));
    const bar = selectionBar(sel, [
      ignoreAction(ctx, items),
      { label: 'Fix selected', primary: true, run: fix },
      { label: `Fix all (${items.length})`, always: true, run: () => fix(items.map((b) => b.id)) },
    ], [selectAllToggle(sel, items.map((b) => b.id))]);

    const list = h('ul', { class: 'items' });
    const more = pagedList('redirects', list, items, (b) => row(sel, b.id,
      h('div', { class: 'grow' }, bookmarkInfo(b, ctx), h('div', { class: 'redirect-to' },
        h('span', { class: 'muted', text: '→ ' }), h('a', { href: b.finalUrl, target: '_blank', rel: 'noreferrer', text: b.finalUrl }),
        elsewhere.has(b.id) && h('span', { class: 'warn', text: ` Different site: ${siteOf(b.url)} → ${siteOf(b.finalUrl)}`, title: 'The old site may have closed and its address been taken over; check the page before fixing' }))),
      [h('button', { class: 'small', text: 'Fix', onclick: () => fix([b.id]) })]));
    bindCheckboxes(list, sel);
    const note = elsewhere.size > 0 && h('p', { class: 'warn', text: `${elsewhere.size} of these go to a different site; check those before fixing.` });
    return h('section', {}, header, note, bar, list, more);
  },
};
