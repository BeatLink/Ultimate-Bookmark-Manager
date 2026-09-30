// Runs the network check for the Broken links and Redirects views and keeps it going while the user switches views.

import { h, toast } from './dom.js';
import { checkAll, isCheckable, isSkipped } from '../lib/linkcheck.js';
import { saveLinkResults } from '../lib/settings.js';

const ALL_SITES = { origins: ['<all_urls>'] };

export class LinkChecker {
  running = false;
  done = 0;
  total = 0;
  #controller = null;
  #bars = [];

  constructor(ctx) {
    this.ctx = ctx;
  }

  // Must be called straight from a click handler: Firefox only shows the permission prompt for a user action.
  start(ids = null) {
    if (this.running) return;
    browser.permissions.request(ALL_SITES).then((granted) => {
      if (!granted) toast('Checking links needs permission to access websites.', 'error');
      else this.#run(ids);
    });
  }

  cancel() {
    this.#controller?.abort();
  }

  async #run(ids) {
    const { state } = this.ctx;
    const { linkCheck } = state.settings;
    const ignored = this.ctx.ignoredIds();
    const wanted = ids ? new Set(ids) : null;
    let skipped = 0;
    const targets = state.flat.filter((b) => {
      if (b.type !== 'bookmark' || ignored.has(b.id) || (wanted && !wanted.has(b.id))) return false;
      if (!isCheckable(b.url) || isSkipped(b.url, linkCheck.skipDomains)) {
        skipped++;
        return false;
      }
      return true;
    });

    this.running = true;
    this.done = 0;
    this.total = targets.length;
    this.#controller = new AbortController();
    this.#paint();
    let results;
    try {
      results = await checkAll(targets, {
        concurrency: linkCheck.concurrency,
        timeout: linkCheck.timeoutSeconds * 1000,
        signal: this.#controller.signal,
        onProgress: (done) => {
          this.done = done;
          this.#paint();
        },
      });
    } finally {
      this.running = false;
    }
    const cancelled = this.#controller.signal.aborted;
    const problems = results.filter((r) => r.status !== 'ok');

    // A partial re-check replaces only the entries for the bookmarks it covered.
    const previous = wanted && state.linkResults ? state.linkResults.results.filter((r) => !wanted.has(r.id)) : [];
    await saveLinkResults({
      time: Date.now(),
      checked: wanted ? state.linkResults?.checked ?? results.length : results.length,
      skipped: wanted ? state.linkResults?.skipped ?? skipped : skipped,
      cancelled,
      results: [...previous, ...problems],
    });
    toast(`${cancelled ? 'Check cancelled' : 'Check finished'}: ${results.length} checked, ${problems.length} need attention.`, 'success');
    await this.ctx.run(async () => {});
  }

  // A progress bar that follows the running check; stale copies drop out once they leave the page.
  progress() {
    const bar = h('div', { class: 'progress', hidden: !this.running },
      h('progress', { max: 1, value: 0 }),
      h('span', { class: 'muted' }),
      h('button', { class: 'small', text: 'Cancel', onclick: () => this.cancel() }));
    this.#bars.push(bar);
    this.#paint();
    return bar;
  }

  #paint() {
    this.#bars = this.#bars.filter((b) => b.isConnected || !b.dataset.painted);
    for (const bar of this.#bars) {
      bar.dataset.painted = '1';
      bar.hidden = !this.running;
      bar.querySelector('progress').max = Math.max(1, this.total);
      bar.querySelector('progress').value = this.done;
      bar.querySelector('span').textContent = `Checked ${this.done} of ${this.total}`;
    }
  }
}
