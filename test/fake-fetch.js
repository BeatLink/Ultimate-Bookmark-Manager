// A fetch stand-in that answers from a table of pages, recording each request it sees.

// A page is { status, html, bytes, type, finalUrl }; HTML is served in small chunks like a network would.
export function fakeFetch(pages, seen = []) {
  return async (url, { credentials, method } = {}) => {
    seen.push({ url, credentials, method });
    const page = typeof pages[url] === 'function' ? pages[url]() : pages[url];
    if (!page) throw new TypeError('NetworkError');
    const bytes = page.bytes ?? new TextEncoder().encode(page.html ?? '');
    const body = new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 16) c.enqueue(bytes.subarray(i, i + 16));
        c.close();
      },
    });
    const headers = new Headers({ 'content-type': page.type ?? 'text/html' });
    return { status: page.status ?? 200, statusText: '', url: page.finalUrl ?? url, redirected: Boolean(page.finalUrl), headers, body };
  };
}
