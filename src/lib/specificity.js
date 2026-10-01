// How specific a rule's match is, so the most specific of several matching rules wins; only the conditions that matched count.

import { bareDomain, siteOfHost } from './domains.js';

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

// Points from URL conditions are worth this many keyword points, so any URL match outranks any number of keyword matches.
export const URL_TIER = 10000;

// A score as people read it: "URL 110 + keywords 40", never the combined number.
export function formatScore(score) {
  const url = Math.floor(score / URL_TIER);
  const keywords = score % URL_TIER;
  const parts = [url && `URL ${url}`, keywords && `keywords ${keywords}`].filter(Boolean);
  return parts.length ? parts.join(' + ') : '0';
}

// A site scores as a domain, and a name inside one as a subdomain.
function domainPoints(value) {
  const host = bareDomain(value).replace(/^www\./, '').split('.').filter(Boolean).join('.');
  return siteOfHost(host) === host ? POINTS.domain : POINTS.subdomain;
}

// A path scores by how many segments it names; "/" alone names none and counts as a keyword.
function pathPoints(value) {
  const segments = String(value).split('/').filter(Boolean).length;
  return segments ? POINTS.path + segments * POINTS.pathSegment : POINTS.keyword;
}

// "URL starts with" scores by how deep its path goes; a bare site scores as a domain.
function prefixPoints(value) {
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
function urlTextPoints(value) {
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
