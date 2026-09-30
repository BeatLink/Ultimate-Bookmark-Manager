// Bookmarks whose URL now redirects elsewhere, with one-click correction to the final URL.

import { h } from '../dom.js';
import { emptyState, bindCheckboxes, selectionBar, selectAllToggle, bookmarkInfo, row } from '../components.js';
import { addToWhitelist } from '../../lib/settings.js';
import { checkControls } from './broken.js';
import * as scans from '../scans.js';

export default {
  id: 'redirects',
  label: 'Redirects',
  badge: (ctx) => scans.linkResults(ctx)?.results.filter((r) => r.status === 'redirect').length,

  render(ctx) {
    const header = checkControls(ctx, 'Redirects', 'Bookmarks whose URL now leads somewhere else');
    const saved = scans.linkResults(ctx);
    if (!saved) return h('section', {}, header);
    const items = saved.results.filter((r) => r.status === 'redirect');
    if (!items.length) return h('section', {}, header, emptyState('No redirects found.'));

    const fix = (ids) => ctx.run(async () => {
      const changes = items.filter((b) => ids.includes(b.id)).map((b) => ({ id: b.id, url: b.finalUrl }));
      await ctx.actions.update(changes, `Updated ${changes.length} redirected URL(s)`);
      ctx.done(`Updated ${changes.length} URL(s).`);
    });
    const sel = ctx.selection('redirects', items.map((b) => b.id));
    const bar = selectionBar(sel, [
      { label: 'Ignore', run: (ids) => ctx.run(() => addToWhitelist(items.filter((b) => ids.includes(b.id)))) },
      { label: 'Fix selected', primary: true, run: fix },
      { label: `Fix all (${items.length})`, always: true, run: () => fix(items.map((b) => b.id)) },
    ], [selectAllToggle(sel, items.map((b) => b.id))]);

    const list = h('ul', { class: 'items' }, items.map((b) => row(sel, b.id,
      h('div', { class: 'grow' }, bookmarkInfo(b, ctx), h('div', { class: 'redirect-to' },
        h('span', { class: 'muted', text: '→ ' }), h('a', { href: b.finalUrl, target: '_blank', rel: 'noreferrer', text: b.finalUrl }))),
      [h('button', { class: 'small', text: 'Fix', onclick: () => fix([b.id]) })])));
    bindCheckboxes(list, sel);
    return h('section', {}, header, bar, list);
  },
};
