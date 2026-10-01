// How specific a rule's match is, so that when several rules match a bookmark the most specific one wins.
// Only the conditions that actually matched count: "any of rust, cargo" matched by "rust" scores one keyword.

export const POINTS = {
  exactUrl: 1000,
  path: 100,
  pathSegment: 10,
  exactQuery: 80,
  paramValue: 60,
  subdomain: 60,
  domain: 50,
  exactTitle: 40,
  param: 30,
  keyword: 20,
  regex: 15,
};

// Points from conditions on the URL are worth this many keyword points, so any URL match outranks any
// number of title or keyword matches, while matches in the same tier still compare by points.
export const URL_TIER = 10000;

// A score split into its URL and keyword parts.
export function splitScore(score) {
  return { url: Math.floor(score / URL_TIER), keywords: score % URL_TIER };
}

// A score as people read it: "URL 110 + keywords 40", never the combined number.
export function formatScore(score) {
  const { url, keywords } = splitScore(score);
  const parts = [url && `URL ${url}`, keywords && `keywords ${keywords}`].filter(Boolean);
  return parts.length ? parts.join(' + ') : '0';
}

// Second-level labels that belong to the country ending, so "bbc.co.uk" is a domain and "news.bbc.co.uk" a subdomain.
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ne', 'or']);

export function domainPoints(value) {
  const labels = String(value).toLowerCase().replace(/^\*?\./, '').replace(/^www\./, '').split('.').filter(Boolean);
  const site = labels.length >= 3 && labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2)) ? 3 : 2;
  return labels.length > site ? POINTS.subdomain : POINTS.domain;
}

// A path scores by how many segments it names; "/" alone names none and counts as a keyword.
export function pathPoints(value) {
  const segments = String(value).split('/').filter(Boolean).length;
  return segments ? POINTS.path + segments * POINTS.pathSegment : POINTS.keyword;
}

// "URL starts with" scores by how deep its path goes; a bare site scores as a domain.
export function prefixPoints(value) {
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return POINTS.keyword;
  }
  const segments = u.pathname.split('/').filter(Boolean).length;
  return segments ? POINTS.path + segments * POINTS.pathSegment : domainPoints(u.hostname);
}

// "youtube.com/@channel" found in a URL scores as a site plus a path; a plain word as a keyword.
export function urlTextPoints(value) {
  const text = String(value);
  if (!/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''))) {
    return text.startsWith('/') ? pathPoints(text) : POINTS.keyword;
  }
  return prefixPoints(text);
}

// Points for one keyword that matched, given which part of the bookmark it matched.
export function valuePoints(op, value, on) {
  if (op === 'onDomain') return domainPoints(value);
  // Text looked for in a part of the URL scores by what it spells out, not as a single word.
  if (op === 'contains' || op === 'beginsWith') {
    if (on === 'host' && String(value).includes('.')) return domainPoints(value);
    if (on === 'path' && String(value).includes('/')) return pathPoints(value);
    if (on === 'url' && /[./]/.test(String(value)) && op !== 'beginsWith') return urlTextPoints(value);
  }
  if (op === 'hasParam') return String(value).includes('=') ? POINTS.paramValue : POINTS.param;
  if (op === 'matchesRegex') return POINTS.regex;
  if (op === '=') {
    if (on === 'url') return POINTS.exactUrl;
    if (on === 'host') return domainPoints(value);
    // An exact path counts one segment more than a prefix of the same depth, so it wins over one.
    if (on === 'path') return pathPoints(value) + POINTS.pathSegment;
    if (on === 'query') return POINTS.exactQuery;
    return POINTS.exactTitle;
  }
  if (op === 'beginsWith' && on === 'url') return prefixPoints(value);
  if (op === 'beginsWith' && on === 'path') return pathPoints(value);
  return POINTS.keyword;
}
