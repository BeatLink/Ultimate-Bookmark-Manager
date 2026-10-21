// Finds how long the main video on each bookmarked page is.

import { checkUrl, isCheckable, failureReason } from './linkcheck.js';
import { loadPages } from './page-titles.js';
import { formatLength } from './html-video.js';
import { pageVideoLength, inPageWindow } from './page-video.js';

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

// Whether opening the page in a tab could still find a length the HTML did not name.
export const worthOpening = (result) => !result.seconds && !['Not a web page', 'Cancelled'].includes(result.error);

// Opens each page in one minimized window, a few at a time, and reads its videos; a Map from bookmark id to { seconds } or { error }.
export const loadPageLengths = (bookmarks, { concurrency = 3, signal, onProgress, ...options } = {}) => inPageWindow(
  (windowId) => loadPages(bookmarks, (url, o) => pageVideoLength(url, { ...options, signal: o.signal, windowId }), { concurrency, signal, onProgress }),
  options.api);

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

// A length written at the start of a name, such as "[1:05] " or "[1:02:03] ".
const NAME_PREFIX = /^\[(?:\d+:)?\d{1,2}:\d{2}\] ?/;

export const hasLengthInName = (title) => NAME_PREFIX.test(title ?? '');

// The name with no length at its start.
export const nameWithoutLength = (title) => (title ?? '').replace(NAME_PREFIX, '');

// The name starting with the length, replacing any length already there.
export const nameWithLength = (title, seconds) => `[${formatLength(seconds)}] ${nameWithoutLength(title)}`.trimEnd();
