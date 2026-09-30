// How specific a rule's match is, so that when several rules match a bookmark the most specific one wins.
// Only the conditions that actually matched count: "any of rust, cargo" matched by "rust" scores one keyword.

export const POINTS = {
  exactUrl: 1000,
  path: 100,
  pathSegment: 10,
  subdomain: 60,
  domain: 50,
  exactTitle: 40,
  keyword: 20,
  regex: 15,
};

// A catch-all scores below any rule that matched, so it only wins when nothing else does (or through priority).
export const CATCH_ALL_SCORE = -1;

// Second-level labels that belong to the country ending, so "bbc.co.uk" is a domain and "news.bbc.co.uk" a subdomain.
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ne', 'or']);

export function domainPoints(value) {
  const labels = String(value).toLowerCase().replace(/^\*?\./, '').replace(/^www\./, '').split('.').filter(Boolean);
  const site = labels.length >= 3 && labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2)) ? 3 : 2;
  return labels.length > site ? POINTS.subdomain : POINTS.domain;
}

// "Address starts with" scores by how deep its path goes; a bare site scores as a domain.
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

// Points for one keyword that matched, given which part of the bookmark it matched.
export function valuePoints(op, value, on) {
  if (op === 'domain') return domainPoints(value);
  if (op === 'regex') return POINTS.regex;
  if (op === 'equals') return on === 'url' ? POINTS.exactUrl : POINTS.exactTitle;
  if (op === 'startsWith' && on === 'url') return prefixPoints(value);
  return POINTS.keyword;
}
