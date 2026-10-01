// The progress of a long job, shown in bars any view can add; the job outlives the views, so switching away does not lose it.

import { h } from './dom.js';

export class ProgressJob {
  running = false;
  done = 0;
  total = 0;
  controller = null;
  #bars = new Set();
  #text;

  // `text(done, total)` is the line shown beside the bar.
  constructor(text) {
    this.#text = text;
  }

  // Marks the job as running and returns the signal that cancelling it aborts.
  start(total) {
    this.running = true;
    this.done = 0;
    this.total = total;
    this.controller = new AbortController();
    this.paint();
    return this.controller.signal;
  }

  progress(done) {
    this.done = done;
    this.paint();
  }

  finish() {
    this.running = false;
    this.paint();
  }

  cancel() {
    this.controller?.abort();
  }

  get cancelled() {
    return !!this.controller?.signal.aborted;
  }

  // A bar that follows the job; it is hidden while nothing runs and dropped once it leaves the page.
  bar() {
    const bar = h('div', { class: 'progress', hidden: !this.running },
      h('progress', { max: 1, value: 0 }),
      h('span', { class: 'muted' }),
      h('button', { class: 'small', text: 'Cancel', onclick: () => this.cancel() }));
    this.#bars.add(bar);
    this.#paintBar(bar);
    return bar;
  }

  paint() {
    for (const bar of this.#bars) {
      // A bar is painted once when built, before the view puts it on the page; one that is off the page after that has left it.
      if (!bar.isConnected && bar.dataset.painted) this.#bars.delete(bar);
      else this.#paintBar(bar);
    }
  }

  #paintBar(bar) {
    bar.dataset.painted = '1';
    bar.hidden = !this.running;
    bar.querySelector('progress').max = Math.max(1, this.total);
    bar.querySelector('progress').value = this.done;
    bar.querySelector('span').textContent = this.#text(this.done, this.total);
  }
}
