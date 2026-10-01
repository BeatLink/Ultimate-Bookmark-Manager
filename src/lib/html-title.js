// Reads a page's title from the start of its HTML, without loading the rest of the page.

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

// The title of an HTML response, read from its first bytes; empty for other files or a page without one.
export async function readTitle(res) {
  if (!/html|xml/i.test(res.headers?.get?.('content-type') ?? 'text/html')) {
    res.body?.cancel?.().catch(() => {});
    return '';
  }
  const bytes = await readHead(res);
  let html;
  try {
    html = new TextDecoder(charsetOf(res, bytes)).decode(bytes);
  } catch {
    html = new TextDecoder().decode(bytes);
  }
  return titleFromHtml(html);
}
