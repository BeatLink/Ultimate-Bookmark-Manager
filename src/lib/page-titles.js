// Opens bookmarked pages in a hidden browser window and reads the title each one shows once loaded.

import { checkUrl, CATEGORIES } from './linkcheck.js';
import { unhelpfulName } from './folders.js';

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
export async function loadTitle(url, { tabs, windowId, timeout = 20000, settle = 1500, fetchImpl, signal }) {
  if (!/^https?:\/\//i.test(url)) return { error: 'Not a web page' };
  // A quick request first, so a dead link does not hand back the browser's error-page title.
  const check = await checkUrl(url, { timeout: Math.min(timeout, 15000), fetchImpl, signal });
  if (check.status === 'broken') return { error: CATEGORIES[check.category].label.replace(/ \(.*\)$/, '') };

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

// Loads many pages a few at a time in one minimized window, which is closed afterwards; its starting tab keeps it open between pages.
export async function loadTitles(bookmarks, { tabs, windows, concurrency = 3, timeout, settle, fetchImpl, signal, onProgress }) {
  const results = new Map();
  const win = await windows.create({ state: 'minimized', focused: false });
  let next = 0;
  let closed = false;
  const onClosed = (id) => { if (id === win.id) closed = true; };
  windows.onRemoved?.addListener(onClosed);
  const worker = async () => {
    while (next < bookmarks.length && !signal?.aborted && !closed) {
      const b = bookmarks[next++];
      let result;
      try {
        result = await loadTitle(b.url, { tabs, windowId: win.id, timeout, settle, fetchImpl, signal });
      } catch {
        result = { error: signal?.aborted || closed ? 'Cancelled' : 'Could not open the page' };
      }
      results.set(b.id, result);
      onProgress?.(results.size, bookmarks.length);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, bookmarks.length)) }, worker));
  } finally {
    windows.onRemoved?.removeListener(onClosed);
    if (!closed) await windows.remove(win.id).catch(() => {});
  }
  return results;
}
