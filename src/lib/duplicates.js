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

function compilePattern(pattern, flags = '') {
  return new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
}

// Turns stored rules into regexes, collecting a readable error for each invalid one.
export function compileRules(rules = []) {
  const filters = [];
  const replacements = [];
  const errors = [];
  rules.forEach((rule, i) => {
    if (rule.enabled === false || !rule.pattern) return;
    let re;
    let conditions;
    try {
      re = compilePattern(rule.pattern, rule.flags ?? '');
      conditions = compileConditions(rule.conditions);
    } catch (err) {
      errors.push({ index: i, message: err.message });
      return;
    }
    if (rule.kind === 'filter') filters.push({ re, field: rule.field ?? 'url', conditions });
    else replacements.push({ re, replacement: rule.replacement ?? '', conditions });
  });
  return { filters, replacements, errors };
}

// A rule's conditions as regexes; one with no pattern is left out.
function compileConditions(conditions) {
  if (!Array.isArray(conditions)) return [];
  return conditions.filter((c) => c?.pattern).map((c, i) => {
    try {
      return { re: compilePattern(c.pattern, c.flags ?? ''), field: c.field ?? 'url', negate: !!c.negate };
    } catch (err) {
      throw new Error(`Condition ${i + 1}: ${err.message}`, { cause: err });
    }
  });
}

function test(re, text) {
  re.lastIndex = 0;
  return re.test(text);
}

// True when every condition of a rule holds for these texts.
const conditionsHold = (conditions, texts) => conditions.every(({ re, field, negate }) => test(re, texts[field] ?? texts.url) !== negate);

// Returns the key two bookmarks must share to count as duplicates, or null when a filter excludes it.
function comparisonKey(bookmark, matching, compiled) {
  const title = bookmark.title ?? '';
  const name = [...bookmark.path, title].join('/');
  const texts = { url: bookmark.url, title, name };
  for (const { re, field, conditions } of compiled.filters) {
    if (conditionsHold(conditions, texts) && test(re, texts[field] ?? texts.url)) return null;
  }
  const ctx = { url: bookmark.url, name, title };
  let url = bookmark.url;
  for (const { re, replacement, conditions } of compiled.replacements) {
    if (!conditionsHold(conditions, { ...texts, url })) continue;
    url = url.replace(re, (match, ...rest) => {
      const groups = rest.slice(0, rest.findIndex((x) => typeof x === 'number'));
      return expandReplacement(replacement, match, groups, ctx);
    });
  }
  return normalizeUrl(url, matching);
}

// Groups bookmarks sharing a comparison key, each group oldest first and numbered with its place in the tree; `extra` counts the copies beyond the first of each.
export function findDuplicates(bookmarks, { matching = DEFAULT_MATCHING, rules = [], ignoredIds = new Set() } = {}) {
  const compiled = compileRules(rules);
  const keyed = [];
  bookmarks.forEach((b, position) => {
    if (b.type !== 'bookmark' || ignoredIds.has(b.id)) return;
    const key = comparisonKey(b, matching, compiled);
    if (key !== null) keyed.push({ key, b: { ...b, position } });
  });
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

// ============================================================================
// Choosing which copies to select
// ============================================================================

const idsOf = (groups, keep) => groups.flatMap((g) => g.items.filter((item) => !keep(item, g)).map((item) => item.id));

// Every copy except the one highest up in the bookmarks, or lowest down with `lowest`.
export function allButTreeEnd(groups, lowest = false) {
  const pickEnd = (items) => items.reduce((best, item) => ((lowest ? item.position > best.position : item.position < best.position) ? item : best));
  const kept = new Set(groups.map((g) => pickEnd(g.items).id));
  return idsOf(groups, (item) => kept.has(item.id));
}

// Every copy inside one of the folders.
export function copiesInFolders(groups, folderIds) {
  return groups.flatMap((g) => g.items.filter((item) => folderIds.has(item.parentId)).map((item) => item.id));
}

// In each group with a copy inside the folders, every copy but the oldest one there; other groups are left alone.
export function keepCopyInFolders(groups, folderIds) {
  return groups.flatMap((g) => {
    const kept = g.items.find((item) => folderIds.has(item.parentId));
    return kept ? g.items.filter((item) => item !== kept).map((item) => item.id) : [];
  });
}

// Copies that share their folder with an older copy of the same URL.
export function sameFolderExtras(groups) {
  return groups.flatMap((g) => {
    const seen = new Set();
    const extras = [];
    for (const item of g.items) {
      if (seen.has(item.parentId)) extras.push(item.id);
      seen.add(item.parentId);
    }
    return extras;
  });
}

// The folders holding a copy, directly or further down, in tree order, each with its full path.
export function foldersHoldingCopies(groups, flat) {
  const byId = new Map(flat.map((node) => [node.id, node]));
  const holding = new Set();
  for (const item of groups.flatMap((g) => g.items)) {
    for (let id = item.parentId; byId.has(id) && !holding.has(id); id = byId.get(id).parentId) holding.add(id);
  }
  return flat.filter((node) => holding.has(node.id)).map((node) => ({ id: node.id, path: [...node.path, node.title] }));
}

// A folder's id with the ids of every folder inside it.
export function folderAndSubfolders(flat, folderId) {
  const out = new Set([folderId]);
  for (const node of flat) if (node.type === 'folder' && out.has(node.parentId)) out.add(node.id);
  return out;
}
