// Bookmarks whose name is blank or just their URL, which can be renamed from the title their page shows.

import { h, toast } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectionBar, selectAllToggle, bookmarkInfo, row, pagedList, pickIds, ignoreAction, removeAction } from '../components.js';
import { ProgressJob } from '../progress.js';
import { askAllSites } from '../permissions.js';
import { loadTitles } from '../../lib/page-titles.js';
import { fetchOptions } from '../../lib/linkcheck.js';
import * as scans from '../scans.js';

const REASONS = { blank: 'Name is blank', url: 'Name is just a URL' };

// The running title fetch, kept here so switching views does not lose it.
const job = new ProgressJob((done, total) => `Loading pages: ${done} of ${total}`);
// Why each page could not be named, shown beside it after a fetch.
const failures = new Map();

// The title the last link check read for this bookmark, while its URL is still the one checked.
function foundTitle(ctx, b) {
  const found = scans.linkResults(ctx)?.titles?.[b.id];
  return found && found.url === b.url ? found.title : null;
}

// Renames the bookmarks that got a title, as one undoable step, and keeps the reason for the rest.
async function applyTitles(ctx, items, results) {
  const changes = [];
  for (const [id, r] of results) {
    if (r.title) changes.push({ id, title: r.title });
    else failures.set(id, r.error);
  }
  await ctx.run(async () => {
    if (changes.length) await ctx.actions.update(changes, `Named ${changes.length} bookmark(s) from their page title`);
    const missed = items.length - changes.length;
    const message = `Named ${changes.length} of ${items.length} bookmark(s).${missed ? ` ${missed} could not be named; see each one for why.` : ''}`;
    if (changes.length) ctx.done(message);
    else toast(message, 'error');
  });
}

// Names the bookmarks from titles the link check already found or, straight from the click so Firefox may ask for permission, from their pages.
function fetchTitles(ctx, items) {
  if (job.running) return;
  for (const b of items) failures.delete(b.id);
  const known = new Map(items.filter((b) => foundTitle(ctx, b)).map((b) => [b.id, { title: foundTitle(ctx, b) }]));
  const rest = items.filter((b) => !known.has(b.id));
  if (!rest.length) return applyTitles(ctx, items, known);
  askAllSites().then(async (granted) => {
    if (!granted) return toast('Reading page titles needs permission to access websites.', 'error');
    const signal = job.start(rest.length);
    let results;
    try {
      results = await loadTitles(rest, { ...fetchOptions(ctx.state.settings.linkCheck), signal, onProgress: (done) => job.progress(done) });
    } catch (err) {
      toast(`Could not load pages: ${err.message ?? err}`, 'error');
      return;
    } finally {
      job.finish();
    }
    await applyTitles(ctx, items, new Map([...known, ...results]));
  });
}

export default {
  id: 'untitled',
  label: 'No useful name',
  badge: (ctx) => scans.untitled(ctx).length,

  render(ctx) {
    const items = scans.untitled(ctx);
    const sel = ctx.selection('untitled', items.map((b) => b.id));
    const header = viewHeader('Bookmarks without a useful name', 'Names that are blank or just a URL');
    if (!items.length) return h('section', {}, header, emptyState('Every bookmark has a useful name.'));

    const bar = selectionBar(sel, [
      { label: 'Fetch page titles', primary: true, title: 'Name each selected bookmark after its page title, using titles the link check already found and reading the other pages', run: (ids) => fetchTitles(ctx, pickIds(items, ids)) },
      ignoreAction(ctx, items),
      removeAction(ctx, { ask: (ids) => `Remove ${ids.length} bookmark(s)?`, label: (ids) => `Removed ${ids.length} bookmark(s) without a useful name`, done: (ids) => `Removed ${ids.length} bookmark(s).` }),
    ], [selectAllToggle(sel, items.map((b) => b.id))]);

    const list = h('ul', { class: 'items' });
    const more = pagedList('untitled', list, items, (b) => {
      const found = foundTitle(ctx, b);
      return row(sel, b.id, bookmarkInfo(b, ctx, {
        meta: [
          h('span', { class: 'reason', text: REASONS[b.reason] }),
          failures.has(b.id) && h('span', { class: 'status', text: `No title: ${failures.get(b.id)}` }),
          found && h('span', { class: 'found-title', text: `Page title: ${found}` }),
        ],
      }));
    });
    bindCheckboxes(list, sel);
    return h('section', {}, header, bar, job.bar(), list, more);
  },
};
