// Bookmarks whose name is blank.

import { h, Selection, confirmDialog } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectionBar, selectAllToggle, bookmarkInfo, row } from '../components.js';
import { addToWhitelist } from '../../lib/settings.js';
import * as scans from '../scans.js';

// Uses the URL's host and path as a readable stand-in name.
function nameFromUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '')) || url;
  } catch {
    return url;
  }
}

export default {
  id: 'untitled',
  label: 'No name',
  badge: (ctx) => scans.untitled(ctx).length,

  render(ctx) {
    const items = scans.untitled(ctx);
    const sel = new Selection();
    const header = viewHeader('Bookmarks without a name', 'Give them a name with Edit, name them after their address, or remove them.');
    if (!items.length) return h('section', {}, header, emptyState('Every bookmark has a name.'));

    const bar = selectionBar(sel, [
      { label: 'Name from address', primary: true, run: (ids) => ctx.run(async () => {
        await ctx.actions.update(items.filter((b) => ids.includes(b.id)).map((b) => ({ id: b.id, title: nameFromUrl(b.url) })), `Named ${ids.length} bookmark(s) from their address`);
        ctx.done(`Named ${ids.length} bookmark(s).`);
      }) },
      { label: 'Ignore', run: (ids) => ctx.run(() => addToWhitelist(items.filter((b) => ids.includes(b.id)))) },
      { label: 'Remove selected', danger: true, run: async (ids) => {
        if (!(await confirmDialog(`Remove ${ids.length} bookmark(s)?`, 'Remove'))) return;
        await ctx.run(async () => {
          await ctx.actions.remove(ids, `Removed ${ids.length} bookmark(s) without a name`);
          ctx.done(`Removed ${ids.length} bookmark(s).`);
        });
      } },
    ], [selectAllToggle(sel, items.map((b) => b.id))]);

    const list = h('ul', { class: 'items' }, items.map((b) => row(sel, b.id, bookmarkInfo(b, ctx))));
    bindCheckboxes(list, sel);
    return h('section', {}, header, bar, list);
  },
};
