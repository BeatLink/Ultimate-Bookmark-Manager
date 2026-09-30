// Organize rules: match bookmarks by title, URL, part of the URL or folder, and plan moves into target folders.

import { valuePoints, CATCH_ALL_SCORE, URL_TIER, formatScore } from './specificity.js';
import { buildOrder, rankCandidates, lostBecause } from './rule-order.js';

// A rule's conditions are a react-querybuilder query. Each condition is { field, operator, value } with one keyword
// as its value, plus `caseSensitive` and `wholeWords`; several keywords are several conditions in a group.
// Operator names follow react-querybuilder's where one fits.
export const OPERATORS = {
  contains: 'contains',
  doesNotContain: 'does not contain',
  beginsWith: 'starts with',
  endsWith: 'ends with',
  '=': 'is',
  matchesRegex: 'matches regex',
  onDomain: 'is on domain',
  hasParam: 'has query parameter',
  inFolder: 'is in or under',
  directlyInFolder: 'is directly in',
};

const TEXT_OPS = ['contains', 'doesNotContain', 'beginsWith', 'endsWith', '=', 'matchesRegex'];

// The operators each field offers; domains belong to the site name and parameters to the query string.
export const FIELD_OPERATORS = {
  either: TEXT_OPS,
  title: TEXT_OPS,
  url: TEXT_OPS,
  host: [...TEXT_OPS, 'onDomain'],
  path: TEXT_OPS,
  query: [...TEXT_OPS, 'hasParam'],
  fragment: TEXT_OPS,
  folder: ['inFolder', 'directlyInFolder'],
};

export const FIELDS = {
  either: 'title or URL',
  title: 'title',
  url: 'URL',
  host: 'site name',
  path: 'URL path',
  query: 'query string',
  fragment: 'part after #',
  folder: 'folder',
};

// Folder conditions narrow a rule down to where a bookmark sits; they never add to how specific its match is.
export const FOLDER_OPS = new Set(['inFolder', 'directlyInFolder']);

// Operators where "whole words" applies; domains, regexes and exact matches already have their own edges.
export const WORD_OPS = new Set(['contains', 'doesNotContain', 'beginsWith', 'endsWith']);

// Short names accepted as the first segment of a target path, alongside the root folders' own titles.
const ROOT_ALIASES = {
  menu: 'menu________',
  toolbar: 'toolbar_____',
  other: 'unfiled_____',
  unfiled: 'unfiled_____',
  mobile: 'mobile______',
};

// A group is react-querybuilder's { combinator: 'and' | 'or', not, rules }; `not` inverts the whole group.
export function newGroup(rules = [newCondition()]) {
  return { id: crypto.randomUUID(), combinator: 'or', not: false, rules };
}

export function isGroup(item) {
  return Array.isArray(item?.rules);
}

export function newCondition(field = 'either', operator = 'contains', value = '') {
  if (field === 'folder') return { id: crypto.randomUUID(), field, operator, value };
  return { id: crypto.randomUUID(), field, operator, value, caseSensitive: false, wholeWords: true };
}

export function newRule() {
  return {
    id: crypto.randomUUID(),
    name: '',
    enabled: true,
    query: newGroup(),
    target: '',
    // The rules this one ranks above when both match; the built-in ranking only applies between unrelated rules.
    outranks: [],
    createdAt: Date.now(),
  };
}

// A rule that takes whatever no other rule matches in the folders its conditions name; it always runs last.
export function newCatchAll(folders = []) {
  return { ...newRule(), catchAll: true, query: newGroup(folders.map((f) => newCondition('folder', 'directlyInFolder', f))) };
}

// Copies a rule under a new id so it can be edited separately; the copy's name is marked as such.
// A copy of a condition or group under new ids, as react-querybuilder needs every id on the page to be unique.
function renumber(item) {
  return { ...structuredClone(item), id: crypto.randomUUID(), ...(isGroup(item) && { rules: item.rules.map(renumber) }) };
}

export function duplicateRule(rule) {
  const copy = structuredClone(rule);
  copy.id = crypto.randomUUID();
  copy.createdAt = Date.now();
  copy.name = rule.name ? `${rule.name} (copy)` : '';
  copy.query = renumber(copy.query);
  return copy;
}

// The group without the item that has `id`, wherever it is nested.
function without(group, id) {
  return { ...group, rules: group.rules.filter((item) => item.id !== id).map((item) => (isGroup(item) ? without(item, id) : item)) };
}

function find(group, id) {
  for (const item of group.rules) {
    if (item.id === id) return item;
    const inner = isGroup(item) && find(item, id);
    if (inner) return inner;
  }
  return null;
}

// Moves one condition or group of a rule into a new rule placed after it, with the same destination and ranking.
// Folder conditions that scope the whole rule go with it, so the new rule only looks where the old one did.
// Returns the new list of rules and the new rule, or null when the item is not in the rule.
export function moveToNewRule(rules, ruleId, itemId) {
  const rule = rules.find((r) => r.id === ruleId);
  const item = rule && find(rule.query, itemId);
  if (!item) return null;
  const scoped = rule.query.combinator === 'and' && !rule.query.not;
  const folders = scoped ? rule.query.rules.filter((c) => !isGroup(c) && c.id !== itemId && FOLDER_OPS.has(c.operator) && valueOf(c)) : [];
  const moved = renumber(item);
  const query = folders.length ? { ...newGroup([...folders.map(renumber), moved]), combinator: 'and' }
    : isGroup(moved) ? moved : newGroup([moved]);
  const part = {
    ...newRule(),
    name: `${rule.name || 'Unnamed rule'} (part)`,
    enabled: rule.enabled,
    target: rule.target,
    query,
    outranks: [...(rule.outranks ?? [])],
    ...(rule.rankAll && { rankAll: rule.rankAll }),
  };
  const out = rules.map((r) => {
    if (r.id === ruleId) return { ...r, query: without(r.query, itemId) };
    // Rules ranked above the old rule are ranked above the new one too.
    return r.outranks?.includes(ruleId) ? { ...r, outranks: [...r.outranks, part.id] } : r;
  });
  out.splice(out.findIndex((r) => r.id === ruleId) + 1, 0, part);
  return { rules: out, part };
}

// Rules `rule` can be merged with: any other rule, except that catch-alls only merge with catch-alls.
export function mergeCandidates(rule, rules) {
  return rules.filter((r) => r.id !== rule.id && !!r.catchAll === !!rule.catchAll);
}

// Merges `otherId` into `keepId`: the kept rule matches whatever either matched, keeps its own destination, name and
// tiers, and takes on the other's ranking links. Returns the new list of rules, without the other rule.
export function mergeRules(rules, keepId, otherId) {
  const keep = rules.find((r) => r.id === keepId);
  const other = rules.find((r) => r.id === otherId);
  if (!keep || !other || keep === other) return rules;
  // "Any" groups that are not inverted are joined directly rather than nested.
  const parts = [keep.query, other.query].flatMap((q) => (q.combinator === 'or' && !q.not ? q.rules : [q]));
  const outranks = [...new Set([...(keep.outranks ?? []), ...(other.outranks ?? [])])].filter((id) => id !== keepId && id !== otherId);
  return rules.filter((r) => r !== other).map((r) => {
    if (r === keep) return { ...keep, query: newGroup(parts), outranks };
    if (!r.outranks?.includes(otherId)) return r;
    return { ...r, outranks: [...new Set(r.outranks.map((id) => (id === otherId ? keepId : id)))] };
  });
}

// The condition's keyword, or its folder path.
export function valueOf(cond) {
  return String(cond.value ?? '').trim();
}

const OLD_OPERATORS = { notContains: 'doesNotContain', containsAll: 'contains', startsWith: 'beginsWith', equals: '=', domain: 'onDomain', param: 'hasParam', regex: 'matchesRegex' };
const OLD_FIELDS = { domain: 'host', param: 'query' };

// An old condition with a list of keywords, as one condition per keyword. "Contains all of" and "contains none of"
// become an "and" group; every other operator matched any of its keywords, so it becomes an "or" group.
function migrateCondition(old) {
  const list = (Array.isArray(old.values) ? old.values : String(old.value ?? '').split(',')).map((t) => String(t).trim()).filter(Boolean);
  const field = OLD_FIELDS[old.op] ?? old.field ?? 'either';
  const operator = OLD_OPERATORS[old.op] ?? old.op ?? 'contains';
  const items = (list.length ? list : ['']).map((value) => ({ ...newCondition(field, operator, value), caseSensitive: !!old.caseSensitive, wholeWords: !!old.wholeWords }));
  if (items.length === 1) return items[0];
  return { ...newGroup(items), combinator: old.op === 'containsAll' || old.op === 'notContains' ? 'and' : 'or', fromList: true };
}

// An old { match: 'any' | 'all' | 'none', conditions } group in react-querybuilder's shape; "none" is "not any".
// A keyword list that combines the same way as its group is merged into it rather than nested.
function migrateGroup(old) {
  const combinator = old.match === 'all' ? 'and' : 'or';
  const rules = [];
  for (const item of old.conditions ?? []) {
    const next = item?.type === 'group' ? migrateGroup(item) : migrateCondition(item);
    const { fromList, ...clean } = next;
    if (fromList && clean.combinator === combinator) rules.push(...clean.rules);
    else rules.push(clean);
  }
  return { ...newGroup(rules), combinator, not: old.match === 'none' };
}

// Converts a rule saved before rules used react-querybuilder's shape; its source folders become folder conditions.
// Rules already converted come back unchanged.
export function migrateRule(rule) {
  if (rule.query) return rule;
  const { match, conditions, sources, sourceSubfolders, ...rest } = rule;
  let query = migrateGroup({ match, conditions });
  const folders = (sources ?? []).map((path) => newCondition('folder', sourceSubfolders === false ? 'directlyInFolder' : 'inFolder', path));
  if (folders.length) {
    const scope = folders.length === 1 ? folders[0] : newGroup(folders);
    if (!query.rules.length) query = isGroup(scope) ? scope : newGroup([scope]);
    else if (query.combinator === 'and' && !query.not) query = { ...query, rules: [scope, ...query.rules] };
    else query = { ...newGroup([scope, query]), combinator: 'and' };
  }
  return { ...rest, query };
}

const hosts = new Map();

// The URL's host name, remembered because parsing a URL is slow and rules ask for the same ones repeatedly.
function hostOf(url) {
  if (hosts.has(url)) return hosts.get(url);
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // Not a URL; it has no host.
  }
  if (hosts.size > 50000) hosts.clear();
  hosts.set(url, host);
  return host;
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A letter or digit in any language; with "whole words" a keyword may not touch one on either side.
const WORD = '[\\p{L}\\p{N}]';
const patterns = new Map();

// The pattern for one keyword under a condition's operator and options, built once and reused.
function patternFor(cond, value) {
  const whole = cond.wholeWords && WORD_OPS.has(cond.operator);
  const key = `${cond.operator}|${cond.caseSensitive ? 1 : 0}|${whole ? 1 : 0}|${value}`;
  if (patterns.has(key)) return patterns.get(key);
  let re;
  if (cond.operator === 'matchesRegex') {
    re = new RegExp(value, cond.caseSensitive ? 'g' : 'gi');
  } else {
    const v = escapeRe(value);
    // An edge is only enforced where the keyword itself starts or ends with a letter or digit, so "/a" or "c++" still match.
    const wordChar = /[\p{L}\p{N}]/u;
    const before = whole && wordChar.test(value.at(0)) ? `(?<!${WORD})` : '';
    const after = whole && wordChar.test(value.at(-1)) ? `(?!${WORD})` : '';
    const flags = cond.caseSensitive ? 'gu' : 'giu';
    if (cond.operator === 'beginsWith') re = new RegExp(`^${v}${after}`, flags);
    else if (cond.operator === 'endsWith') re = new RegExp(`${before}${v}$`, flags);
    else if (cond.operator === '=') re = new RegExp(`^${v}$`, flags);
    else re = new RegExp(`${before}${v}${after}`, flags);
  }
  patterns.set(key, re);
  return re;
}

// Where one keyword occurs in a text, as [start, end] pairs; empty when it does not occur.
export function occurrences(cond, value, text) {
  const re = patternFor(cond, value);
  // The pattern is shared, so start from the beginning whatever the last search left behind.
  re.lastIndex = 0;
  const out = [];
  for (const m of text.matchAll(re)) {
    if (!m[0].length) continue;
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

// Splits a URL as written into site name, path, query string and fragment (RFC 3986, appendix B).
const URL_SHAPE = /^(?:[a-z][a-z0-9+.-]*:)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/dis;

// One part of a URL and where it starts in it, so highlights land on the URL as shown; empty when absent.
export function urlPart(url, part) {
  if (part === 'url') return { text: url, start: 0 };
  const m = URL_SHAPE.exec(url);
  const group = { host: 1, path: 2, query: 3, fragment: 4 }[part];
  if (!m || !group || m[group] === undefined) return { text: '', start: url.length };
  let [start] = m.indices[group];
  let text = m[group];
  if (part === 'host') {
    // Drop any "user:password@" before the site name and any ":port" after it.
    const at = text.lastIndexOf('@');
    start += at + 1;
    text = text.slice(at + 1).replace(/:\d*$/, '');
  }
  return { text, start };
}

function domainRanges(value, url) {
  const host = hostOf(url);
  const dom = value.toLowerCase().replace(/^\*?\./, '');
  if (host !== dom && !host.endsWith('.' + dom)) return [];
  const part = urlPart(url, 'host');
  const end = part.start + part.text.length;
  // A site name written differently from how the browser reads it (such as in another script) is highlighted whole.
  return part.text.toLowerCase().endsWith(dom) ? [[end - dom.length, end]] : [[part.start, end]];
}

// Where the query string has parameter `name`, or `name=value` when a value is given.
function paramRanges(cond, value, url) {
  const part = urlPart(url, 'query');
  const fold = (s) => (cond.caseSensitive ? s : s.toLowerCase());
  const eq = value.indexOf('=');
  const name = fold(eq < 0 ? value : value.slice(0, eq));
  const out = [];
  let at = part.start;
  for (const pair of part.text.split('&')) {
    const split = pair.indexOf('=');
    const key = split < 0 ? pair : pair.slice(0, split);
    const val = split < 0 ? '' : pair.slice(split + 1);
    if (pair && fold(key) === name && (eq < 0 || fold(val) === fold(value.slice(eq + 1)))) out.push([at, at + pair.length]);
    at += pair.length + 1;
  }
  return out;
}

// The parts of a bookmark a condition looks at: the title, the whole URL or one part of it.
function fieldsOf(cond) {
  return !cond.field || cond.field === 'either' ? ['title', 'url'] : [cond.field];
}

// Where the keyword occurs in one part of a bookmark, as ranges in the title (for "title") or else in the URL.
// Throws on an invalid regex so callers can report it.
function rangesIn(cond, value, bookmark, on) {
  const url = bookmark.url ?? '';
  if (cond.operator === 'onDomain') return domainRanges(value, url);
  if (cond.operator === 'hasParam') return paramRanges(cond, value, url);
  if (on === 'title') return occurrences(cond, value, bookmark.title ?? '');
  const part = urlPart(url, on);
  return occurrences(cond, value, part.text).map(([s, e]) => [s + part.start, e + part.start]);
}

// A folder condition's folder as a path of titles; without the root folders to resolve it, the path as written.
function folderPath(value, rootFolders) {
  if (rootFolders) return resolveTarget(value, rootFolders)?.path ?? null;
  const segments = value.split('/').map((s) => s.trim()).filter(Boolean);
  return segments.length ? segments : null;
}

// A rule's `query` is a group: `combinator` says how its `rules` combine, `not` inverts it, and any item may be a nested group.
// Conditions without a value and groups with nothing active are ignored, so a half-written rule never matches everything.
function activeItems(group) {
  return (group?.rules ?? []).filter((item) => (isGroup(item) ? activeItems(item).length : valueOf(item)));
}

function allConditions(group) {
  return (group?.rules ?? []).flatMap((item) => (isGroup(item) ? allConditions(item) : [item]));
}

// A condition prepared once per plan: which parts of a bookmark it reads and a test of one part.
function compileCondition(cond, rootFolders) {
  const value = valueOf(cond);
  const op = cond.operator;
  if (FOLDER_OPS.has(op)) {
    const path = folderPath(value, rootFolders);
    const inside = (p) => !!path && startsWithPath(p, path) && (op === 'inFolder' || p.length === path.length);
    return { op, folder: true, test: (text) => inside(text.path) };
  }
  const fields = fieldsOf(cond);
  let hit;
  if (op === 'onDomain') {
    const dom = value.toLowerCase().replace(/^\*?\./, '');
    hit = (text) => {
      const host = hostOf(text.url);
      return host === dom || host.endsWith('.' + dom);
    };
  } else if (op === 'hasParam') {
    hit = (text) => paramRanges(cond, value, text.url).length > 0;
  } else {
    const re = patternFor(cond, value);
    hit = (text, on) => {
      re.lastIndex = 0;
      const found = re.test(text.part(on));
      re.lastIndex = 0;
      return found;
    };
  }
  // Conditions aimed only at the URL rank in the URL tier; "title or URL" stays a keyword condition.
  return { op, value, fields, hit, tier: fields.includes('title') ? 1 : URL_TIER };
}

// A rule's conditions prepared once per plan, with inactive items already dropped.
function compileGroup(group, rootFolders) {
  return { combinator: group.combinator, not: !!group.not, items: activeItems(group).map((item) => (isGroup(item) ? compileGroup(item, rootFolders) : compileCondition(item, rootFolders))) };
}

// The specificity of a condition's match, or null when it does not hold.
function conditionScore(c, text) {
  if (c.folder) return c.test(text) ? 0 : null;
  // "Does not contain" on the title and URL must hold for both.
  if (c.op === 'doesNotContain') return c.fields.every((on) => !c.hit(text, on)) ? 0 : null;
  const on = c.fields.find((f) => c.hit(text, f));
  return on ? valuePoints(c.op, c.value, on) * c.tier : null;
}

// Only the conditions that hold count towards a group's score, so "any" of several keywords scores the ones found.
function groupScore(group, text) {
  const scores = group.items.map((item) => (item.items ? groupScore(item, text) : conditionScore(item, text)));
  const hits = scores.filter((x) => x !== null);
  const sum = hits.reduce((a, b) => a + b, 0);
  const held = group.combinator === 'and' ? hits.length === scores.length : hits.length > 0;
  // An inverted group scores nothing when it holds, as what it rules out is not a match.
  if (group.not) return held ? null : 0;
  return held ? sum : null;
}

// A bookmark's title, URL and folder path, with each part of the URL split out once when first asked for.
function bookmarkText(bookmark) {
  const title = bookmark.title ?? '';
  const url = bookmark.url ?? '';
  const parts = {};
  return { url, path: bookmark.path ?? [], part: (on) => (on === 'title' ? title : on === 'url' ? url : (parts[on] ??= urlPart(url, on).text)) };
}

// Scores bookmarks against one rule, or null when the rule does not match; build it once and reuse it for every bookmark.
// A catch-all scores below any other match, whatever its conditions scored.
function scorer(rule, rootFolders) {
  const compiled = compileGroup(rule.query ?? {}, rootFolders);
  if (!compiled.items.length) return () => null;
  if (rule.catchAll) return (bookmark) => (groupScore(compiled, bookmarkText(bookmark)) === null ? null : CATCH_ALL_SCORE);
  return (bookmark) => groupScore(compiled, bookmarkText(bookmark));
}

// The most a rule can score: every condition it lists matching, in the part of the bookmark worth the most.
export function maxScore(rule) {
  if (rule.catchAll) return CATCH_ALL_SCORE;
  const cond = (c) => {
    if (FOLDER_OPS.has(c.operator) || c.operator === 'doesNotContain') return 0;
    const fields = fieldsOf(c);
    const tier = fields.includes('title') ? 1 : URL_TIER;
    return Math.max(...fields.map((f) => valuePoints(c.operator, valueOf(c), f))) * tier;
  };
  const group = (g) => (g.not ? 0 : activeItems(g).reduce((sum, item) => sum + (isGroup(item) ? group(item) : cond(item)), 0));
  return group(rule.query);
}

// Whether one condition holds for a bookmark.
export function conditionMatches(cond, bookmark, rootFolders) {
  return !!valueOf(cond) && conditionScore(compileCondition(cond, rootFolders), bookmarkText(bookmark)) !== null;
}

// What made a condition hold: the keyword, where it matched, and the character ranges to highlight.
// Null when the condition does not hold; an empty list for folder and "does not contain" conditions that hold.
function conditionHits(cond, bookmark, rootFolders) {
  if (!conditionMatches(cond, bookmark, rootFolders)) return null;
  if (FOLDER_OPS.has(cond.operator) || cond.operator === 'doesNotContain') return [];
  const value = valueOf(cond);
  const hits = [];
  for (const on of fieldsOf(cond)) {
    const ranges = rangesIn(cond, value, bookmark, on);
    if (ranges.length) hits.push({ value, on, ranges });
  }
  return hits;
}

function groupHits(group, bookmark, rootFolders) {
  const parts = activeItems(group).map((item) => (isGroup(item) ? groupHits(item, bookmark, rootFolders) : conditionHits(item, bookmark, rootFolders)));
  const hit = parts.filter((x) => x !== null);
  const held = group.combinator === 'and' ? hit.length === parts.length : hit.length > 0;
  if (group.not) return held ? null : [];
  return held ? hit.flat() : null;
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

// Why a rule matched a bookmark: the keywords that matched and where, plus merged ranges to highlight in the
// title and the URL. Null when the rule does not match; a catch-all matches with nothing to show.
export function explainMatch(rule, bookmark, rootFolders) {
  if (!activeItems(rule.query).length) return null;
  const hits = groupHits(rule.query, bookmark, rootFolders);
  if (!hits) return null;
  if (rule.catchAll) return { terms: [], title: [], url: [] };
  const terms = new Map();
  for (const hit of hits) {
    if (!terms.has(hit.value)) terms.set(hit.value, new Set());
    terms.get(hit.value).add(hit.on);
  }
  return {
    terms: [...terms].map(([value, on]) => ({ value, on: [...on] })),
    title: mergeRanges(hits.filter((x) => x.on === 'title').flatMap((x) => x.ranges)),
    url: mergeRanges(hits.filter((x) => x.on !== 'title').flatMap((x) => x.ranges)),
  };
}

// How specifically the rule matches the bookmark, or null when it does not match at all.
export function ruleScore(rule, bookmark, rootFolders) {
  return scorer(rule, rootFolders)(bookmark);
}

export function ruleMatches(rule, bookmark, rootFolders) {
  return ruleScore(rule, bookmark, rootFolders) !== null;
}

// One condition in plain words, e.g. `title contains “rust”` or `folder is in or under “Other Bookmarks › Inbox”`.
export function describeCondition(cond) {
  const value = valueOf(cond);
  const subject = FIELDS[cond.field] ?? FIELDS.either;
  if (FOLDER_OPS.has(cond.operator)) return `${subject} ${OPERATORS[cond.operator]} “${value.split('/').join(' › ')}”`;
  // Matching inside words is the risky setting ("cat" in "category"), so the summary says when it is on.
  const inside = WORD_OPS.has(cond.operator) && !cond.wholeWords ? ' (also inside words)' : '';
  return `${subject} ${OPERATORS[cond.operator] ?? cond.operator} “${value}”${cond.caseSensitive && cond.operator !== 'onDomain' ? ' (exact case)' : ''}${inside}`;
}

function describeGroup(group, nested) {
  const parts = activeItems(group).map((item) => (isGroup(item) ? describeGroup(item, true) : describeCondition(item)));
  const joined = parts.join(group.combinator === 'and' ? ' and ' : ' or ');
  if (group.not) return `not (${joined})`;
  return nested && parts.length > 1 ? `(${joined})` : joined;
}

// The rule's logic in one line, with nested groups in brackets and inverted groups always as "not (…)" so they read unambiguously.
export function describeRule(rule) {
  const text = activeItems(rule.query).length ? describeGroup(rule.query, false) : 'No conditions yet';
  return rule.catchAll ? `Anything no other rule matches where ${text}` : text;
}

// Resolves "Root/Sub/Folder" against the top-level folders; a path not starting with one goes under Other Bookmarks.
export function resolveTarget(target, rootFolders) {
  const segments = String(target ?? '').split('/').map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return null;
  const first = segments[0].toLowerCase();
  const byAlias = ROOT_ALIASES[first];
  const root = rootFolders.find((r) => r.id === byAlias || r.title.toLowerCase() === first);
  if (root) return { rootId: root.id, path: [root.title, ...segments.slice(1)], segments: segments.slice(1) };
  const other = rootFolders.find((r) => r.id === 'unfiled_____') ?? rootFolders[0];
  return { rootId: other.id, path: [other.title, ...segments], segments };
}

function startsWithPath(path, prefix) {
  return prefix.length <= path.length && prefix.every((seg, i) => path[i] === seg);
}

// Whether the rule's conditions, folder conditions included, match the bookmark.
export function ruleApplies(rule, bookmark, rootFolders) {
  return ruleMatches(rule, bookmark, rootFolders);
}

// Checks each rule once so the editor can show a problem next to the rule that has it; folders are checked only when `flat` is given.
export function validateRules(rules, rootFolders, flat = null) {
  const problems = new Map();
  const folders = flat && new Set(flat.filter((n) => n.type === 'folder').map((n) => [...n.path, n.title].join('\0')));
  for (const rule of rules) {
    const issues = [];
    const active = allConditions(rule.query).filter(valueOf);
    const inFolders = active.filter((c) => FOLDER_OPS.has(c.operator));
    if (rule.catchAll) {
      if (!inFolders.length) issues.push('A catch-all rule needs a folder condition, or it would move every bookmark you have.');
    } else if (active.length === inFolders.length) {
      issues.push('Add a condition on the title or URL; folder conditions only narrow a rule down.');
    }
    if (!resolveTarget(rule.target, rootFolders)) issues.push('Choose a target folder.');
    if (folders) {
      for (const c of inFolders) {
        const path = folderPath(valueOf(c), rootFolders);
        if (path && !folders.has(path.join('\0'))) issues.push(`The folder “${path.join(' › ')}” no longer exists.`);
      }
    }
    for (const c of active) {
      if (c.operator !== 'matchesRegex') continue;
      try {
        new RegExp(valueOf(c));
      } catch (err) {
        issues.push(`Invalid regex “${valueOf(c)}”: ${err.message}`);
      }
    }
    if (issues.length) problems.set(rule.id, issues);
  }
  return problems;
}

// Rules caught in a ranking loop or a link against the tiers, each with a note; the rules still run, only those links are ignored.
export function rankingWarnings(rules) {
  const warnings = new Map();
  const order = buildOrder(rules);
  const add = (r, text) => warnings.set(r.id, [...(warnings.get(r.id) ?? []), text]);
  for (const loop of order.loops) {
    const names = loop.map((r) => `“${r.name || 'Unnamed rule'}”`).join(', ');
    for (const r of loop) add(r, `${names} rank above each other in a loop, so those links are ignored until one is removed.`);
  }
  const name = (r) => `“${r.name || 'Unnamed rule'}”`;
  for (const [high, low] of order.against) {
    const why = low.rankAll === 'above' ? `${name(low)} ranks above all other rules` : `${name(high)} ranks below all other rules`;
    for (const r of [high, low]) add(r, `${name(high)} is set to rank above ${name(low)}, but ${why}, so that link is ignored.`);
  }
  return warnings;
}

// Works out where each bookmark should go. Of the enabled, valid rules that match it, a rule
// wins over any it ranks above by the ranking lists; between rules no list relates, the more specific match wins
// (URL conditions before keywords), then the newer rule, and catch-alls only take what nothing else matches.
// `tree` is the whole flattened tree, used to check the folders conditions name exist when `flat` holds only some bookmarks.
// `unmatched` lists the bookmarks no enabled, valid rule matches.
export function planMoves(flat, rules, rootFolders, ignoredIds = new Set(), tree = flat) {
  const problems = validateRules(rules, rootFolders, tree);
  const order = buildOrder(rules);
  // Disabled rules are still scored so the editor can say what they would match; they never win.
  const valid = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => !problems.has(rule.id))
    .map((u) => ({ ...u, target: resolveTarget(u.rule.target, rootFolders), score: scorer(u.rule, rootFolders), on: u.rule.enabled !== false }));
  const moves = [];
  const unmatched = [];
  const wins = new Map();
  const matches = new Map();
  for (const b of flat) {
    if (b.type !== 'bookmark' || ignoredIds.has(b.id)) continue;
    const candidates = [];
    for (const u of valid) {
      const score = u.score(b);
      if (score === null) continue;
      matches.set(u.rule.id, (matches.get(u.rule.id) ?? 0) + 1);
      if (!u.on) continue;
      candidates.push({ rule: u.rule, index: u.index, target: u.target, score });
    }
    if (!candidates.length) {
      unmatched.push(b);
      continue;
    }
    // Ranking lists decide between related rules; the built-in ranking only between rules no list relates.
    const ranked = candidates.length > 1 ? rankCandidates(candidates, order) : candidates;
    const best = ranked[0];
    wins.set(best.rule.id, (wins.get(best.rule.id) ?? 0) + 1);
    // The winning rule decides even when the bookmark is already where it says, so a weaker rule cannot move it away.
    if (startsWithPath(b.path, best.target.path)) continue;
    let ranking = null;
    moves.push({ bookmark: b, ruleId: best.rule.id, ruleName: best.rule.name, target: best.target, score: best.score, others: candidates.length - 1, why: explainMatch(best.rule, b, rootFolders),
      // Every matching rule, strongest first, each with what it matched and, below the winner, why it lost; worked out when first read.
      get ranking() {
        ranking ??= ranked.map((c) => ({
          ruleId: c.rule.id, ruleName: c.rule.name, target: c.target, score: c.score, catchAll: !!c.rule.catchAll,
          why: explainMatch(c.rule, b, rootFolders), lost: c === best ? null : lostBecause(c, best, ranked, order, formatScore),
        }));
        return ranking;
      } });
  }
  return { moves, unmatched, problems, wins, matches };
}
