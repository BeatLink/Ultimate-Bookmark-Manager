// Bookmarks whose name is blank or just their URL, which can be renamed from the title their page shows.

import { h, confirmDialog, toast } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectionBar, selectAllToggle, bookmarkInfo, row, pagedList, pickIds } from '../components.js';
import { addToWhitelist } from '../../lib/settings.js';
import { loadTitles } from '../../lib/page-titles.js';
import * as scans from '../scans.js';

const REASONS = { blank: 'Name is blank', url: 'Name is just a URL' };

// The running title fetch and the pages it could not name; kept here so switching views does not lose them.
const job = { running: false, done: 0, total: 0, controller: null, failures: new Map(), bars: new Set() };

function paint() {
  for (const bar of job.bars) {
    if (!bar.isConnected) {
      job.bars.delete(bar);
      continue;
    }
    bar.hidden = !job.running;
    bar.querySelector('progress').max = Math.max(1, job.total);
    bar.querySelector('progress').value = job.done;
    bar.querySelector('span').textContent = `Loading pages: ${job.done} of ${job.total}`;
  }
}

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
    else job.failures.set(id, r.error);
  }
  await ctx.run(async () => {
    if (changes.length) await ctx.actions.update(changes, `Named ${changes.length} bookmark(s) from their page title`);
    const missed = items.length - changes.length;
    const message = `Named ${changes.length} of ${items.length} bookmark(s).${missed ? ` ${missed} could not be named; see each one for why.` : ''}`;
    if (changes.length) ctx.done(message);
    else toast(message, 'error');
  });
}

// Titles the link check already found are used as they are; only the other pages are fetched.
// Must run straight from a click, as Firefox only shows the permission prompt for a user action.
function fetchTitles(ctx, items) {
  if (job.running) return;
  for (const b of items) job.failures.delete(b.id);
  const known = new Map(items.filter((b) => foundTitle(ctx, b)).map((b) => [b.id, { title: foundTitle(ctx, b) }]));
  const rest = items.filter((b) => !known.has(b.id));
  if (!rest.length) return applyTitles(ctx, items, known);
  browser.permissions.request({ origins: ['<all_urls>'] }).then(async (granted) => {
    if (!granted) return toast('Reading page titles needs permission to access websites.', 'error');
    Object.assign(job, { running: true, done: 0, total: rest.length, controller: new AbortController() });
    paint();
    const { linkCheck } = ctx.state.settings;
    let results;
    try {
      results = await loadTitles(rest, {
        concurrency: linkCheck.concurrency,
        timeout: linkCheck.timeoutSeconds * 1000,
        cookies: linkCheck.useCookies,
        noCookieWords: linkCheck.noCookieWords,
        loginHosts: linkCheck.loginHosts,
        signal: job.controller.signal,
        onProgress: (done) => { job.done = done; paint(); },
      });
    } catch (err) {
      toast(`Could not load pages: ${err.message ?? err}`, 'error');
      return;
    } finally {
      job.running = false;
      paint();
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

    const progress = h('div', { class: 'progress', hidden: true },
      h('progress', { max: 1, value: 0 }), h('span', { class: 'muted' }),
      h('button', { class: 'small', text: 'Cancel', onclick: () => job.controller?.abort() }));
    job.bars.add(progress);
    paint();

    const bar = selectionBar(sel, [
      { label: 'Fetch page titles', primary: true, title: 'Name each selected bookmark after its page title, using titles the link check already found and reading the other pages', run: (ids) => fetchTitles(ctx, pickIds(items, ids)) },
      { label: 'Ignore', run: (ids) => ctx.run(() => addToWhitelist(pickIds(items, ids))) },
      { label: 'Remove selected', danger: true, run: async (ids) => {
        if (!(await confirmDialog(`Remove ${ids.length} bookmark(s)?`, 'Remove'))) return;
        await ctx.run(async () => {
          await ctx.actions.remove(ids, `Removed ${ids.length} bookmark(s) without a useful name`);
          ctx.done(`Removed ${ids.length} bookmark(s).`);
        });
      } },
    ], [selectAllToggle(sel, items.map((b) => b.id))]);

    const list = h('ul', { class: 'items' });
    const more = pagedList('untitled', list, items, (b) => row(sel, b.id, bookmarkInfo(b, ctx, {
      meta: [
        h('span', { class: 'reason', text: REASONS[b.reason] }),
        job.failures.has(b.id) && h('span', { class: 'status', text: `No title: ${job.failures.get(b.id)}` }),
        foundTitle(ctx, b) && h('span', { class: 'found-title', text: `Page title: ${foundTitle(ctx, b)}` }),
      ],
    })));
    bindCheckboxes(list, sel);
    return h('section', {}, header, bar, progress, list, more);
  },
};
