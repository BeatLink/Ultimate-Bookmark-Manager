// Runs the network check for the Broken links and Redirects views and keeps it going while the user switches views.

import { h, toast, formatDateTime } from './dom.js';
import { viewHeader } from './components.js';
import { ProgressJob } from './progress.js';
import { askAllSites } from './permissions.js';
import { checkAll, checkTargets, mergeLinkResults, fetchOptions } from '../lib/linkcheck.js';
import { saveLinkResults } from '../lib/settings.js';
import { findUntitled } from '../lib/folders.js';
import * as scans from './scans.js';

export class LinkChecker {
  job = new ProgressJob((done, total) => `Checked ${done} of ${total}`);

  constructor(ctx) {
    this.ctx = ctx;
  }

  get running() {
    return this.job.running;
  }

  get done() {
    return this.job.done;
  }

  get total() {
    return this.job.total;
  }

  // A progress bar that follows the running check.
  progress() {
    return this.job.bar();
  }

  cancel() {
    this.job.cancel();
  }

  // Must be called straight from a click handler: Firefox only shows the permission prompt for a user action.
  start(ids = null) {
    if (this.running) return;
    askAllSites().then((granted) => {
      if (!granted) toast('Checking links needs permission to access websites.', 'error');
      else this.#run(ids);
    });
  }

  async #run(ids) {
    const { state } = this.ctx;
    const { linkCheck } = state.settings;
    const ignored = this.ctx.ignoredIds();
    const wanted = ids ? new Set(ids) : null;
    const { targets, skipped } = checkTargets(state.flat, linkCheck, ignored, wanted);
    // Bookmarks without a useful name also have their page title read, in the same request.
    const unnamed = new Set(findUntitled(state.flat, ignored).map((b) => b.id));

    const signal = this.job.start(targets.length);
    let results;
    try {
      results = await checkAll(targets, {
        ...fetchOptions(linkCheck),
        titleFor: (b) => unnamed.has(b.id),
        signal,
        onProgress: (done) => this.job.progress(done),
      });
    } finally {
      this.job.finish();
    }
    const cancelled = this.job.cancelled;
    const saved = mergeLinkResults(state.linkResults, { results, skipped, cancelled, wanted });
    await saveLinkResults(saved);
    const problems = results.filter((r) => r.status !== 'ok').length;
    toast(`${cancelled ? 'Check cancelled' : 'Check finished'}: ${results.length} checked, ${problems} need attention.`, 'success');
    await this.ctx.reload();
  }
}

// Header, progress bar and summary of the last check, shared by the Broken links and Redirects views.
export function checkControls(ctx, title, description) {
  const saved = scans.linkResults(ctx);
  const checker = ctx.linkChecker;
  const summary = saved
    ? `Last check ${formatDateTime(saved.time)}: ${saved.checked} checked, ${saved.skipped} skipped${saved.cancelled ? ' (cancelled part-way)' : ''}.`
    : 'Links have not been checked yet.';
  return h('div', {},
    viewHeader(title, description,
      h('button', { class: 'primary', text: saved ? 'Check again' : 'Check all links', disabled: checker.running, onclick: () => checker.start() })),
    h('p', { class: 'muted', text: summary }),
    checker.progress());
}
