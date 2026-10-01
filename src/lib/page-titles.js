// Reads the title of bookmarked pages from their HTML.

import { checkUrl, CATEGORIES } from './linkcheck.js';

// A failed check becomes a short reason, such as "Not found".
const reasonFor = (check) => ({
  error: check.status === 'broken' || check.status === 'uncertain'
    ? CATEGORIES[check.category].label.replace(/ — .*$/, '').replace(/ \(.*\)$/, '')
    : 'Title is set by scripts or missing',
});

// Fetches one page through the link check and returns { title } or { error }.
export async function fetchTitle(url, options = {}) {
  if (!/^https?:\/\//i.test(url)) return { error: 'Not a web page' };
  const check = await checkUrl(url, { ...options, detectLogin: true, wantTitle: true });
  if (check.category === 'login') return { error: 'Redirects to a login page' };
  if (check.pageTitle) return { title: check.pageTitle };
  return reasonFor(check);
}

// Runs `task` over the items a few at a time until done, cancelled or `stop` says so.
async function eachLimited(items, concurrency, task, stop) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stop()) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
}

// Names many pages from their HTML, a few at a time, reporting progress after each one.
export async function loadTitles(bookmarks, { concurrency = 6, timeout = 15000, signal, onProgress, ...fetchOptions }) {
  const results = new Map();
  await eachLimited(bookmarks, concurrency, async (b) => {
    let result;
    try {
      result = await fetchTitle(b.url, { ...fetchOptions, timeout, signal });
    } catch {
      result = { error: signal?.aborted ? 'Cancelled' : 'Could not load the page' };
    }
    results.set(b.id, result);
    onProgress?.(results.size, bookmarks.length);
  }, () => signal?.aborted);
  return results;
}
