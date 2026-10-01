// Duplicate detection: built-in URL normalisation plus user-defined filter and replace rules.

import { formatPath } from './tree.js';
import { groupBy } from './group.js';

export const DEFAULT_MATCHING = {
  ignoreProtocol: false,
  ignoreWww: false,
  ignoreTrailingSlash: false,
  ignoreFragment: false,
  ignoreQuery: false,
  ignoreCase: false,
};

// Reduces a URL to its comparison form according to the matching options.
export function normalizeUrl(url, opts = DEFAULT_MATCHING) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return opts.ignoreCase ? url.toLowerCase() : url;
  }
  const web = u.protocol === 'http:' || u.protocol === 'https:';
  if (!web) return opts.ignoreCase ? u.href.toLowerCase() : u.href;

  const protocol = opts.ignoreProtocol ? 'http(s):' : u.protocol;
  const auth = u.username ? `${u.username}${u.password ? ':' + u.password : ''}@` : '';
  const host = opts.ignoreWww ? u.hostname.replace(/^www\./, '') : u.hostname;
  const port = u.port ? ':' + u.port : '';
  let path = u.pathname;
  if (opts.ignoreTrailingSlash) path = path.replace(/\/+$/, '');
  const search = opts.ignoreQuery ? '' : u.search;
  const hash = opts.ignoreFragment ? '' : u.hash;

  const key = `${protocol}//${auth}${host}${port}${path}${search}${hash}`;
  return opts.ignoreCase ? key.toLowerCase() : key;
}

// Expands a replacement template; supports $&, $1-$99, $$, $URL, $NAME, $TITLE and a leading \L or \U.
export function expandReplacement(template, match, groups, ctx) {
  let caseMode = null;
  let body = template;
  if (body.startsWith('\\L')) {
    caseMode = 'lower';
    body = body.slice(2);
  } else if (body.startsWith('\\U')) {
    caseMode = 'upper';
    body = body.slice(2);
  }
  const out = body.replace(/\$(URL|NAME|TITLE|&|\$|\d{1,2})/g, (_, token) => {
    switch (token) {
      case '$': return '$';
      case '&': return match;
      case 'URL': return ctx.url;
      case 'NAME': return ctx.name;
      case 'TITLE': return ctx.title;
      default: return groups[Number(token) - 1] ?? '';
    }
  });
  if (caseMode === 'lower') return out.toLowerCase();
  if (caseMode === 'upper') return out.toUpperCase();
  return out;
}

// Turns stored rules into regexes, collecting a readable error for each invalid one.
export function compileRules(rules = []) {
  const filters = [];
  const replacements = [];
  const errors = [];
  rules.forEach((rule, i) => {
    if (rule.enabled === false || !rule.pattern) return;
    let re;
    try {
      const flags = rule.flags ?? '';
      re = new RegExp(rule.pattern, flags.includes('g') ? flags : flags + 'g');
    } catch (err) {
      errors.push({ index: i, message: err.message });
      return;
    }
    if (rule.kind === 'filter') filters.push({ re, field: rule.field ?? 'url' });
    else replacements.push({ re, replacement: rule.replacement ?? '' });
  });
  return { filters, replacements, errors };
}

function test(re, text) {
  re.lastIndex = 0;
  return re.test(text);
}

// Returns the key two bookmarks must share to count as duplicates, or null when a filter excludes it.
function comparisonKey(bookmark, matching, compiled) {
  const title = bookmark.title ?? '';
  const name = [...bookmark.path, title].join('/');
  for (const { re, field } of compiled.filters) {
    const text = field === 'title' ? title : field === 'name' ? name : bookmark.url;
    if (test(re, text)) return null;
  }
  const ctx = { url: bookmark.url, name, title };
  let url = bookmark.url;
  for (const { re, replacement } of compiled.replacements) {
    url = url.replace(re, (match, ...rest) => {
      const groups = rest.slice(0, rest.findIndex((x) => typeof x === 'number'));
      return expandReplacement(replacement, match, groups, ctx);
    });
  }
  return normalizeUrl(url, matching);
}

// Groups bookmarks sharing a comparison key, each group oldest first and numbered; `extra` counts the copies beyond the first of each.
export function findDuplicates(bookmarks, { matching = DEFAULT_MATCHING, rules = [], ignoredIds = new Set() } = {}) {
  const compiled = compileRules(rules);
  const keyed = [];
  for (const b of bookmarks) {
    if (b.type !== 'bookmark' || ignoredIds.has(b.id)) continue;
    const key = comparisonKey(b, matching, compiled);
    if (key !== null) keyed.push({ key, b });
  }
  const groups = [];
  for (const [key, items] of groupBy(keyed, (x) => x.key)) {
    if (items.length < 2) continue;
    const sorted = items.map((x) => x.b).sort((a, b) => a.dateAdded - b.dateAdded || formatPath(a.path).localeCompare(formatPath(b.path)));
    groups.push({ key, items: sorted.map((b, i) => ({ ...b, order: i + 1 })) });
  }
  groups.sort((a, b) => a.key.localeCompare(b.key));
  const extra = groups.reduce((n, g) => n + g.items.length - 1, 0);
  return { groups, errors: compiled.errors, extra };
}
