// Reads the title of bookmarked pages from their HTML, loading a page in a hidden window only when its title is set by scripts.

import { checkUrl, credentialsFor, hasRiskyWord, isLoginRedirect, CATEGORIES, DEFAULT_NO_COOKIE_WORDS, DEFAULT_LOGIN_HOSTS } from './linkcheck.js';
import { unhelpfulName } from './folders.js';

// The title is near the top of a page, so reading stops after this many bytes.
const MAX_BYTES = 512 * 1024;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™' };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

// The page's <title>, or its og:title when the title is missing; empty when it has neither.
export function titleFromHtml(html) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const og = /<meta\s[^>]*property\s*=\s*["']og:title["'][^>]*>/i.exec(html)?.[0];
  const ogTitle = og ? /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(og) : null;
  const pick = title.trim() ? title : ogTitle?.[1] ?? ogTitle?.[2] ?? '';
  return decodeEntities(pick).replace(/\s+/g, ' ').trim();
}

// The character set named by the Content-Type header or a <meta> tag near the top of the page.
function charsetOf(res, bytes) {
  const header = res.headers?.get?.('content-type') ?? '';
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(header)?.[1];
  if (fromHeader) return fromHeader;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  return /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8';
}

// Reads up to MAX_BYTES of the body, stopping early once the title has closed.
async function readHead(res) {
  const reader = res.body?.getReader?.();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  const seen = new TextDecoder('latin1');
  let text = '';
  try {
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      text += seen.decode(value, { stream: true });
      if (/<\/title>/i.test(text) || /<body[\s>]/i.test(text)) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

// A failed check becomes a short reason, such as "Not found"; a page the check found fine is left to the window.
const reasonFor = (check) => (check.status === 'broken' || check.status === 'uncertain'
  ? { error: CATEGORIES[check.category].label.replace(/ — .*$/, '').replace(/ \(.*\)$/, '') }
  : { needsWindow: true });

// Fetches one page's HTML and returns { title }, { error }, or { needsWindow } when the HTML has no usable title.
export async function fetchTitle(url, { timeout = 15000, fetchImpl = globalThis.fetch.bind(globalThis), signal, cookies = false, noCookieWords = DEFAULT_NO_COOKIE_WORDS, loginHosts = DEFAULT_LOGIN_HOSTS } = {}) {
  if (!/^https?:\/\//i.test(url)) return { error: 'Not a web page' };
  const checkOptions = { timeout, fetchImpl, signal, cookies, noCookieWords, detectLogin: true, loginHosts };
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeout);
  const cancel = () => ctrl.abort();
  signal?.addEventListener('abort', cancel);
  try {
    let res;
    try {
      res = await fetchImpl(url, { method: 'GET', redirect: 'follow', credentials: credentialsFor(url, { cookies, noCookieWords }), cache: 'no-store', signal: ctrl.signal });
    } catch {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (timedOut) return { error: 'Timed out' };
      // The full link check sorts out why it failed, such as a DNS or TLS error.
      return reasonFor(await checkUrl(url, checkOptions));
    }
    if (res.status >= 400) {
      res.body?.cancel?.().catch(() => {});
      return reasonFor(await checkUrl(url, checkOptions));
    }
    const finalUrl = res.url || url;
    if (res.redirected && isLoginRedirect(url, finalUrl, loginHosts)) {
      res.body?.cancel?.().catch(() => {});
      return { error: 'Redirects to a login page' };
    }
    // Other files, such as PDFs, only show a title once the browser has opened them.
    if (!/html|xml/i.test(res.headers?.get?.('content-type') ?? 'text/html')) {
      res.body?.cancel?.().catch(() => {});
      return { needsWindow: true };
    }
    let bytes;
    try {
      bytes = await readHead(res);
    } catch (err) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (timedOut) return { error: 'Timed out' };
      throw err;
    }
    let html;
    try {
      html = new TextDecoder(charsetOf(res, bytes)).decode(bytes);
    } catch {
      html = new TextDecoder().decode(bytes);
    }
    const title = titleFromHtml(html);
    if (title && !unhelpfulName(title, finalUrl) && !unhelpfulName(title, url)) return { title };
    return { needsWindow: true };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
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
