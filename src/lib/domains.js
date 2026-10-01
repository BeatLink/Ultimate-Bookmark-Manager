// Host names and the domains that rules, skip lists and the dashboard compare them with.

// Second-level labels that belong to the country ending, so "bbc.co.uk" is one site and "news.bbc.co.uk" is inside it.
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ne', 'or']);

// A domain as written in a rule or a list: lower-cased, without a leading "*." or ".".
export function bareDomain(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^\*?\./, '');
}

// True when the host is the domain itself or a name inside it.
export function onDomain(host, domain) {
  return !!domain && (host === domain || host.endsWith('.' + domain));
}

// The site a host belongs to: "docs.python.org" gives "python.org" and "news.bbc.co.uk" gives "bbc.co.uk".
export function siteOfHost(host) {
  const labels = host.split('.');
  const keep = labels.length >= 3 && labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2)) ? 3 : 2;
  return labels.slice(-keep).join('.');
}
