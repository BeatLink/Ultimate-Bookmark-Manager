// Checks bookmark URLs over the network and sorts the outcome into broken, redirected or fine.

export const CATEGORIES = {
  notFound: { label: 'Not found (404 / 410)', severity: 'broken' },
  serverError: { label: 'Server error (5xx)', severity: 'broken' },
  clientError: { label: 'Other client error (4xx)', severity: 'broken' },
  unreachable: { label: 'Unreachable (DNS, connection or TLS error)', severity: 'broken' },
  timeout: { label: 'Timed out', severity: 'broken' },
  denied: { label: 'Access denied (401 / 403) — may still work when logged in', severity: 'uncertain' },
  rateLimited: { label: 'Rate limited (429) — try again later', severity: 'uncertain' },
};

export function isCheckable(url) {
  return /^https?:\/\//i.test(url ?? '');
}

// True when the URL's host equals a skip-list entry or is a subdomain of one.
export function isSkipped(url, skipList) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return skipList.some((entry) => {
    const d = entry.trim().toLowerCase().replace(/^\*\./, '');
    return d && (host === d || host.endsWith('.' + d));
  });
}

export function categorize(httpStatus) {
  if (httpStatus === 404 || httpStatus === 410) return 'notFound';
  if (httpStatus === 401 || httpStatus === 403) return 'denied';
  if (httpStatus === 429) return 'rateLimited';
  if (httpStatus >= 500) return 'serverError';
  if (httpStatus >= 400) return 'clientError';
  return null;
}

function sameUrl(a, b) {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}

async function request(fetchImpl, url, method, timeout, outer) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeout);
  const cancel = () => ctrl.abort();
  outer?.addEventListener('abort', cancel);
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    // Only the status matters, so stop downloading the body.
    res.body?.cancel?.().catch(() => {});
    return { res };
  } catch (error) {
    if (outer?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return { error: timedOut ? 'timeout' : error };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', cancel);
  }
}

// Checks one URL with HEAD, falling back to GET because many servers answer HEAD wrongly.
export async function checkUrl(url, { timeout = 15000, signal, fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  let attempt = await request(fetchImpl, url, 'HEAD', timeout, signal);
  if (attempt.error || attempt.res.status >= 400) {
    const retry = await request(fetchImpl, url, 'GET', timeout, signal);
    if (!retry.error || attempt.error) attempt = retry;
  }
  if (attempt.error === 'timeout') return { url, status: 'broken', category: 'timeout' };
  if (attempt.error) {
    return { url, status: 'broken', category: 'unreachable', detail: String(attempt.error.message ?? attempt.error) };
  }
  const { res } = attempt;
  const category = categorize(res.status);
  if (category) {
    return { url, status: CATEGORIES[category].severity, category, httpStatus: res.status, detail: res.statusText };
  }
  if (res.redirected && res.url && !sameUrl(res.url, url)) {
    return { url, status: 'redirect', httpStatus: res.status, finalUrl: res.url };
  }
  return { url, status: 'ok', httpStatus: res.status };
}

// Checks many bookmarks with limited parallelism, reporting progress after each one.
export async function checkAll(bookmarks, { concurrency = 6, timeout, signal, onProgress, fetchImpl } = {}) {
  const results = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < bookmarks.length) {
      if (signal?.aborted) return;
      const b = bookmarks[next++];
      let result;
      try {
        result = await checkUrl(b.url, { timeout, signal, fetchImpl });
      } catch (err) {
        if (err.name === 'AbortError') return;
        result = { url: b.url, status: 'broken', category: 'unreachable', detail: String(err) };
      }
      results.push({ ...result, id: b.id, title: b.title, path: b.path });
      onProgress?.(++done, bookmarks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}
