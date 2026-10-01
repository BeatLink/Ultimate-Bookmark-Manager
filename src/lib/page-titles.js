// Reads the title of bookmarked pages from their HTML, loading a page in a hidden window only when its title is set by scripts.

import { checkUrl, hasRiskyWord, CATEGORIES, DEFAULT_NO_COOKIE_WORDS } from './linkcheck.js';
import { unhelpfulName } from './folders.js';

// A failed check becomes a short reason, such as "Not found"; a page the check found fine is left to the window.
const reasonFor = (check) => (check.status === 'broken' || check.status === 'uncertain'
  ? { error: CATEGORIES[check.category].label.replace(/ — .*$/, '').replace(/ \(.*\)$/, '') }
  : { needsWindow: true });

// Fetches one page through the link check and returns { title }, { error }, or { needsWindow } when its HTML has no usable title.
export async function fetchTitle(url, options = {}) {
  if (!/^https?:\/\//i.test(url)) return { error: 'Not a web page' };
  const check = await checkUrl(url, { ...options, detectLogin: true, wantTitle: true });
  if (check.category === 'login') return { error: 'Redirects to a login page' };
  if (check.pageTitle) return { title: check.pageTitle };
  return reasonFor(check);
}

// Waits until the tab reports it has finished loading, or until the timeout passes.
function whenLoaded(tabs, tabId, timeout) {
  return new Promise((resolve) => {
    const done = (loaded) => {
      clearTimeout(timer);
      tabs.onUpdated.removeListener(listener);
      resolve(loaded);
    };
    const listener = (id, change) => {
      if (id === tabId && change.status === 'complete') done(true);
    };
    const timer = setTimeout(() => done(false), timeout);
    tabs.onUpdated.addListener(listener);
    // The page may already have finished before the listener was added.
    tabs.get(tabId).then((t) => t.status === 'complete' && t.url !== 'about:blank' && done(true), () => done(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Loads one page in the given window and returns { title } or { error }.
async function windowTitle(url, { tabs, windowId, timeout, settle }) {
  const tab = await tabs.create({ windowId, url, active: false });
  try {
    await tabs.update(tab.id, { muted: true }).catch(() => {});
    const loaded = await whenLoaded(tabs, tab.id, timeout);
    // Many pages set or change their title with scripts just after loading.
    await sleep(settle);
    const { title = '', url: shown = url } = await tabs.get(tab.id);
    const clean = title.replace(/\s+/g, ' ').trim();
    if (!unhelpfulName(clean, shown) && !unhelpfulName(clean, url)) return { title: clean };
    return { error: loaded ? 'Page has no title' : 'Timed out' };
  } finally {
    await tabs.remove(tab.id).catch(() => {});
  }
}

// Runs `task` over the items a few at a time until done, cancelled or `stop` says so.
async function eachLimited(items, concurrency, task, stop) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stop()) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
}

// Names many pages: first from their HTML, then, if `windowFallback` is on, by loading the rest in one minimized window.
export async function loadTitles(bookmarks, {
  tabs,
  windows,
  concurrency = 6,
  windowConcurrency = 3,
  timeout = 20000,
  settle = 1500,
  windowFallback = true,
  fetchImpl,
  signal,
  onProgress,
  ...fetchOptions
}) {
  const results = new Map();
  const report = (id, result) => {
    results.set(id, result);
    onProgress?.(results.size, bookmarks.length);
  };

  const leftover = [];
  await eachLimited(bookmarks, concurrency, async (b) => {
    let result;
    try {
      result = await fetchTitle(b.url, { ...fetchOptions, timeout: Math.min(timeout, 15000), fetchImpl, signal });
    } catch {
      result = { error: signal?.aborted ? 'Cancelled' : 'Could not load the page' };
    }
    if (!result.needsWindow) report(b.id, result);
    else if (!windowFallback) report(b.id, { error: 'Title is set by scripts or missing' });
    // Opening the page in a tab always sends your cookies, so pages that could change your account are left alone.
    else if (hasRiskyWord(b.url, fetchOptions.noCookieWords ?? DEFAULT_NO_COOKIE_WORDS)) report(b.id, { error: 'Not opened: looks like a logout or unsubscribe link' });
    else leftover.push(b);
  }, () => signal?.aborted);
  if (!leftover.length || signal?.aborted) return results;

  // The window's starting tab keeps it open between pages.
  const win = await windows.create({ state: 'minimized', focused: false });
  let closed = false;
  const onClosed = (id) => { if (id === win.id) closed = true; };
  windows.onRemoved?.addListener(onClosed);
  try {
    await eachLimited(leftover, windowConcurrency, async (b) => {
      let result;
      try {
        result = await windowTitle(b.url, { tabs, windowId: win.id, timeout, settle });
      } catch {
        result = { error: signal?.aborted || closed ? 'Cancelled' : 'Could not open the page' };
      }
      report(b.id, result);
    }, () => signal?.aborted || closed);
  } finally {
    windows.onRemoved?.removeListener(onClosed);
    if (!closed) await windows.remove(win.id).catch(() => {});
  }
  return results;
}
