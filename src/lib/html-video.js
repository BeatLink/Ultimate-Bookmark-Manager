// Reads the length of a page's main video from the metadata in its HTML, without running the page.

import { readHead } from './html-title.js';

// Video pages name the length near the top, but YouTube's comes most of a megabyte in.
const MAX_BYTES = 3 * 1024 * 1024;
// While reading, the page so far is searched again after each this many new bytes.
const CHECK_EVERY = 64 * 1024;

// The Open Graph tags that give the length in seconds.
const OPEN_GRAPH_NAMES = new Set(['og:video:duration', 'video:duration']);

const positive = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : null);

// Seconds in an ISO 8601 duration such as PT1H2M3S, or null when the text is not one.
export function parseDuration(text) {
  if (typeof text !== 'string') return null;
  const m = /^\s*P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(\d+(?:\.\d+)?S)?)?\s*$/i.exec(text);
  if (!m || !m.slice(1).some(Boolean)) return null;
  const [days, hours, minutes, seconds] = m.slice(1).map((part) => parseFloat(part ?? '0'));
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
}

// Each <meta> tag's attributes, keyed by lower-case name.
function metaTags(html) {
  return [...html.matchAll(/<meta\s[^>]*>/gi)].map(([tag]) => Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)].map(([, name, a, b, c]) => [name.toLowerCase(), a ?? b ?? c])));
}

// The first VideoObject with a duration anywhere inside parsed JSON-LD, nested objects and @graph lists included.
function videoIn(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 10) return null;
  if ([node['@type']].flat().includes('VideoObject')) {
    const seconds = positive(parseDuration(node.duration));
    if (seconds) return seconds;
  }
  for (const value of Object.values(node)) {
    const seconds = videoIn(value, depth + 1);
    if (seconds) return seconds;
  }
  return null;
}

function jsonLdLength(html) {
  for (const [, body] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const seconds = videoIn(JSON.parse(body));
      if (seconds) return seconds;
    } catch { /* a broken block is skipped */ }
  }
  return null;
}

// The main video's length in seconds, from Open Graph tags, schema.org data or YouTube's player data; null when the page names none.
export function lengthFromHtml(html) {
  const metas = metaTags(html);
  const first = (wanted, read) => metas.filter(wanted).map((m) => positive(read(m.content))).find(Boolean) ?? null;
  return first((m) => OPEN_GRAPH_NAMES.has(m.property ?? m.name), Number)
    ?? first((m) => m.itemprop === 'duration', parseDuration)
    ?? jsonLdLength(html)
    ?? positive(Number(/"lengthSeconds":"(\d+)"/.exec(html)?.[1]));
}

// The main video's length in seconds from an HTML response, read only as far as needed; null for other files or a page that names none.
export async function readVideoLength(res) {
  if (!/html|xml/i.test(res.headers?.get?.('content-type') ?? 'text/html')) {
    res.body?.cancel?.().catch(() => {});
    return null;
  }
  let searched = 0;
  const enough = (text) => {
    if (text.length - searched < CHECK_EVERY) return false;
    searched = text.length;
    return lengthFromHtml(text) !== null;
  };
  const bytes = await readHead(res, { maxBytes: MAX_BYTES, enough });
  // The metadata is plain ASCII, so the page's character set does not matter.
  return lengthFromHtml(new TextDecoder('latin1').decode(bytes));
}

// A length as m:ss or h:mm:ss; empty for none.
export function formatLength(seconds) {
  if (!seconds) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
