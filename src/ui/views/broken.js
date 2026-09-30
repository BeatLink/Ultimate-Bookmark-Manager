// Bookmarks whose address failed to load, grouped by kind of failure.

import { h, Selection, confirmDialog, formatDate } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectionBar, selectAllToggle, bookmarkInfo, row } from '../components.js';
import { addToWhitelist } from '../../lib/settings.js';
import { CATEGORIES } from '../../lib/linkcheck.js';
import * as scans from '../scans.js';

// Header, progress bar and summary shared with the Redirects view.
export function checkControls(ctx, title, description) {
  const saved = scans.linkResults(ctx);
  const checker = ctx.linkChecker;
  const summary = saved
    ? `Last check ${formatDate(saved.time)} ${new Date(saved.time).toLocaleTimeString()}: ${saved.checked} checked, ${saved.skipped} skipped${saved.cancelled ? ' (cancelled part-way)' : ''}.`
    : 'Links have not been checked yet. Checking asks for permission to access websites.';
  return h('div', {},
    viewHeader(title, description,
      h('button', { class: 'primary', text: saved ? 'Check again' : 'Check all links', disabled: checker.running, onclick: () => checker.start() })),
    h('p', { class: 'muted', text: summary }),
    checker.progress());
}

export default {
  id: 'broken',
  label: 'Broken links',
  badge: (ctx) => scans.linkResults(ctx)?.results.filter((r) => r.status !== 'redirect').length,

  render(ctx) {
    const header = checkControls(ctx, 'Broken links', 'Bookmarks whose page did not load. “Access denied” and “rate limited” often still work in the browser, so look before removing them.');
    const saved = scans.linkResults(ctx);
    if (!saved) return h('section', {}, header);
    const items = saved.results.filter((r) => r.status !== 'redirect');
    if (!items.length) return h('section', {}, header, emptyState('No broken links found.'));

    const sel = new Selection();
    const bar = selectionBar(sel, [
      { label: 'Check again', title: 'Re-check just the selected bookmarks', run: (ids) => ctx.linkChecker.start(ids) },
      { label: 'Ignore', run: (ids) => ctx.run(() => addToWhitelist(items.filter((b) => ids.includes(b.id)))) },
      { label: 'Remove selected', danger: true, run: async (ids) => {
        if (!(await confirmDialog(`Remove ${ids.length} bookmark(s)?`, 'Remove'))) return;
        await ctx.run(async () => {
          await ctx.actions.remove(ids, `Removed ${ids.length} broken bookmark(s)`);
          ctx.done(`Removed ${ids.length} bookmark(s).`);
        });
      } },
    ], [selectAllToggle(sel, items.map((b) => b.id))]);

    const byCategory = Object.keys(CATEGORIES)
      .map((key) => ({ key, items: items.filter((r) => r.category === key) }))
      .filter((g) => g.items.length);
    const list = h('div', { class: 'groups' }, byCategory.map((g) => h('section', { class: 'group' },
      h('h2', { class: `group-title sticky ${CATEGORIES[g.key].severity}` },
        h('span', { text: `${CATEGORIES[g.key].label} — ${g.items.length}` }),
        selectAllToggle(sel, g.items.map((b) => b.id), 'Select group')),
      h('ul', { class: 'items' }, g.items.map((b) => row(sel, b.id, bookmarkInfo(b, ctx, {
        meta: h('span', { class: 'status', text: [b.httpStatus, b.detail].filter(Boolean).join(' ') || CATEGORIES[b.category].label }),
      })))))));
    bindCheckboxes(list, sel);
    return h('section', {}, header, bar, list);
  },
};
