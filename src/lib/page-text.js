// Downloads a page and pulls out the parts that say what it is about, without running its scripts.

const READ_LIMIT = 512 * 1024;

const tidy = (text) => (text ?? '').replace(/\s+/g, ' ').trim();

// Title, description, main headings and opening text from a parsed HTML document.
export function extractFromDocument(doc) {
  const meta = (...names) => {
    for (const name of names) {
      const el = doc.querySelector(`meta[name="${name}" i], meta[property="${name}" i]`);
      const content = tidy(el?.getAttribute('content'));
      if (content) return content;
    }
    return '';
  };
  for (const el of doc.querySelectorAll('script, style, noscript, template, svg, nav, footer, header, aside, form, iframe')) el.remove();
  const headings = [...doc.querySelectorAll('h1, h2')].map((el) => tidy(el.textContent)).filter((t) => t && t.length < 200).slice(0, 8);
  const main = doc.querySelector('main, article, [role=main]') ?? doc.body;
  return {
    title: tidy(doc.querySelector('title')?.textContent) || meta('og:title', 'twitter:title'),
    description: meta('description', 'og:description', 'twitter:description'),
    headings: [...new Set(headings)].join('. '),
    text: tidy(main?.textContent).slice(0, 2000),
  };
}

async function readStart(res) {
  const charset = /charset=["']?([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1] ?? 'utf-8';
  let decoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    decoder = new TextDecoder();
  }
  if (!res.body?.getReader) return (await res.text()).slice(0, READ_LIMIT);
  const reader = res.body.getReader();
  let text = '';
  let size = 0;
  while (size < READ_LIMIT) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    text += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return text;
}

// Fetches a page and returns its extracted parts, or { error } when it cannot be read as HTML.
export async function fetchPageText(url, { timeout = 15000, signal, fetchImpl = globalThis.fetch.bind(globalThis), parse = (html) => new DOMParser().parseFromString(html, 'text/html') } = {}) {
  if (!/^https?:\/\//i.test(url)) return { error: 'Not a web page' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const cancel = () => ctrl.abort();
  signal?.addEventListener('abort', cancel);
  try {
    const res = await fetchImpl(url, { credentials: 'omit', redirect: 'follow', signal: ctrl.signal });
    if (res.status >= 400) return { error: `HTTP ${res.status}` };
    if (!/html|xml/i.test(res.headers.get('content-type') ?? 'text/html')) return { error: 'Not an HTML page' };
    return extractFromDocument(parse(await readStart(res)));
  } catch (err) {
    if (signal?.aborted) throw err;
    return { error: ctrl.signal.aborted ? 'Timed out' : 'Could not load the page' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
