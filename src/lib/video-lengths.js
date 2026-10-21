// Finds how long the main video on each bookmarked page is.

import { checkUrl, isCheckable, failureReason } from './linkcheck.js';
import { loadPages } from './page-titles.js';

export const NO_LENGTH = 'No video length on the page';

// Fetches one page through the link check and returns { seconds } or { error }.
async function fetchLength(url, options = {}) {
  if (!isCheckable(url)) return { error: 'Not a web page' };
  const check = await checkUrl(url, { ...options, detectLogin: true, wantLength: true });
  if (check.category === 'login') return { error: 'Redirects to a login page' };
  if (check.videoSeconds) return { seconds: check.videoSeconds };
  return { error: failureReason(check) ?? NO_LENGTH };
}

// Reads the video length of many pages, a few at a time; a Map from bookmark id to { seconds } or { error }.
export const loadLengths = (bookmarks, options) => loadPages(bookmarks, fetchLength, options);

// The saved lengths after a search: found ones are added, a failed page keeps its old length, and removed bookmarks are dropped.
export function mergeLengths(saved, bookmarks, results, liveIds) {
  const merged = Object.fromEntries(Object.entries(saved).filter(([id]) => liveIds.has(id)));
  for (const b of bookmarks) {
    const seconds = results.get(b.id)?.seconds;
    if (seconds) merged[b.id] = { url: b.url, seconds };
  }
  return merged;
}

// The saved length of a bookmark while it still has the URL it was found at, or null.
export const lengthFor = (saved, node) => {
  const found = node.url && saved?.[node.id];
  return found && found.url === node.url ? found.seconds : null;
};
