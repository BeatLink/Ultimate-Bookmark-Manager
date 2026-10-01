// Organize rules: their shape, how they are built, edited, read from older saves, described and pointed at folders.

import { MENU, TOOLBAR, OTHER, MOBILE } from './tree.js';

// A rule's conditions are a react-querybuilder query: groups of { field, operator, value } conditions with one keyword each, plus `caseSensitive` and `wholeWords`.
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
const ROOT_ALIASES = { menu: MENU, toolbar: TOOLBAR, other: OTHER, unfiled: OTHER, mobile: MOBILE };

export const ruleName = (rule) => rule.name || 'Unnamed rule';

// A folder path as rules store it ("Other Bookmarks/Dev"), shown with › between the folders.
export const folderLabel = (path) => String(path ?? '').split('/').join(' › ');

// A group is react-querybuilder's { combinator: 'and' | 'or', not, rules }; `not` inverts the whole group.
export function newGroup(rules = [newCondition()], combinator = 'or') {
  return { id: crypto.randomUUID(), combinator, not: false, rules };
}

export function isGroup(item) {
  return Array.isArray(item?.rules);
}

export function newCondition(field = 'either', operator = 'contains', value = '') {
  if (field === 'folder') return { id: crypto.randomUUID(), field, operator, value };
  return { id: crypto.randomUUID(), field, operator, value, caseSensitive: false, wholeWords: false };
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

// A copy of a condition or group under new ids, as the editor needs every id on the page to be unique.
export function renumber(item) {
  return { ...structuredClone(item), id: crypto.randomUUID(), ...(isGroup(item) && { rules: item.rules.map(renumber) }) };
}

// Copies a rule under a new id so it can be edited separately; the copy's name is marked as such.
export function duplicateRule(rule) {
  const copy = structuredClone(rule);
  copy.id = crypto.randomUUID();
  copy.createdAt = Date.now();
  copy.name = rule.name ? `${rule.name} (copy)` : '';
  copy.query = renumber(copy.query);
  return copy;
}

// The condition's keyword, or its folder path.
export function valueOf(cond) {
  return String(cond.value ?? '').trim();
}

// Conditions with a value and groups with something active in them; a half-written rule never matches everything.
export function activeItems(group) {
  return (group?.rules ?? []).filter((item) => (isGroup(item) ? activeItems(item).length : valueOf(item)));
}

// Every condition in the group, however deeply nested.
export function allConditions(group) {
  return (group?.rules ?? []).flatMap((item) => (isGroup(item) ? allConditions(item) : [item]));
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

// Moves a condition or group into a new rule placed after its old one, with the same destination, ranking and scoping folder conditions; null when the item is not in the rule.
export function moveToNewRule(rules, ruleId, itemId) {
  const rule = rules.find((r) => r.id === ruleId);
  const item = rule && find(rule.query, itemId);
  if (!item) return null;
  const scoped = rule.query.combinator === 'and' && !rule.query.not;
  const folders = scoped ? rule.query.rules.filter((c) => !isGroup(c) && c.id !== itemId && FOLDER_OPS.has(c.operator) && valueOf(c)) : [];
  const moved = renumber(item);
  const query = folders.length ? newGroup([...folders.map(renumber), moved], 'and')
    : isGroup(moved) ? moved : newGroup([moved]);
  const part = {
    ...newRule(),
    name: `${ruleName(rule)} (part)`,
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

// Merges `otherId` into `keepId`, which then matches whatever either matched and takes on the other's ranking links; returns the rules without the other.
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

// ---- Rules saved in older shapes ----

const OLD_OPERATORS = { notContains: 'doesNotContain', containsAll: 'contains', startsWith: 'beginsWith', equals: '=', domain: 'onDomain', param: 'hasParam', regex: 'matchesRegex' };
const OLD_FIELDS = { domain: 'host', param: 'query' };
// Fields older versions saved on a rule and this one ignores.
const RETIRED_FIELDS = ['priority', 'fallback', 'catchAll'];

// An old keyword-list condition as one condition per keyword: "all of" and "none of" lists make an "and" group, the rest an "or" group.
function migrateCondition(old) {
  const list = (Array.isArray(old.values) ? old.values : String(old.value ?? '').split(',')).map((t) => String(t).trim()).filter(Boolean);
  const field = OLD_FIELDS[old.op] ?? old.field ?? 'either';
  const operator = OLD_OPERATORS[old.op] ?? old.op ?? 'contains';
  const items = (list.length ? list : ['']).map((value) => ({ ...newCondition(field, operator, value), caseSensitive: !!old.caseSensitive, wholeWords: !!old.wholeWords }));
  if (items.length === 1) return items[0];
  return { ...newGroup(items, old.op === 'containsAll' || old.op === 'notContains' ? 'and' : 'or'), fromList: true };
}

// An old { match, conditions } group in react-querybuilder's shape, with keyword lists that combine the same way merged into it rather than nested.
function migrateGroup(old) {
  const combinator = old.match === 'all' ? 'and' : 'or';
  const rules = [];
  for (const item of old.conditions ?? []) {
    const next = item?.type === 'group' ? migrateGroup(item) : migrateCondition(item);
    const { fromList, ...clean } = next;
    if (fromList && clean.combinator === combinator) rules.push(...clean.rules);
    else rules.push(clean);
  }
  return { ...newGroup(rules, combinator), not: old.match === 'none' };
}

// A rule as this version reads it: an old condition list becomes a query, source folders become folder conditions and retired fields go; a current rule comes back unchanged.
export function migrateRule(rule) {
  const retired = RETIRED_FIELDS.filter((key) => key in rule);
  if (rule.query && !retired.length) return rule;
  const rest = { ...rule };
  for (const key of retired) delete rest[key];
  if (rule.query) return rest;
  const { match, conditions, sources, sourceSubfolders } = rule;
  for (const key of ['match', 'conditions', 'sources', 'sourceSubfolders']) delete rest[key];
  let query = migrateGroup({ match, conditions });
  const folders = (sources ?? []).map((path) => newCondition('folder', sourceSubfolders === false ? 'directlyInFolder' : 'inFolder', path));
  if (folders.length) {
    const scope = folders.length === 1 ? folders[0] : newGroup(folders);
    if (!query.rules.length) query = isGroup(scope) ? scope : newGroup([scope]);
    else if (query.combinator === 'and' && !query.not) query = { ...query, rules: [scope, ...query.rules] };
    else query = newGroup([scope, query], 'and');
  }
  return { ...rest, query };
}

// True when a rule has the shape the organizer reads: an id, a tree of groups and conditions, and a text target.
export function isWellFormedRule(rule) {
  const isCondition = (x) => typeof x.field === 'string' && typeof x.operator === 'string';
  const isItem = (x) => x !== null && typeof x === 'object' && (isGroup(x) ? x.rules.every(isItem) : isCondition(x));
  return typeof rule?.id === 'string' && isGroup(rule.query) && rule.query.rules.every(isItem)
    && (rule.target === undefined || typeof rule.target === 'string') && (rule.outranks === undefined || Array.isArray(rule.outranks));
}

// ---- Rules in words ----

// One condition in plain words, e.g. `title contains “rust”` or `folder is in or under “Other Bookmarks › Inbox”`.
function describeCondition(cond) {
  const value = valueOf(cond);
  const subject = FIELDS[cond.field] ?? FIELDS.either;
  if (FOLDER_OPS.has(cond.operator)) return `${subject} ${OPERATORS[cond.operator]} “${folderLabel(value)}”`;
  const whole = WORD_OPS.has(cond.operator) && cond.wholeWords ? ' (whole words)' : '';
  const exact = cond.caseSensitive && cond.operator !== 'onDomain' ? ' (exact case)' : '';
  return `${subject} ${OPERATORS[cond.operator] ?? cond.operator} “${value}”${exact}${whole}`;
}

function describeGroup(group, nested) {
  const parts = activeItems(group).map((item) => (isGroup(item) ? describeGroup(item, true) : describeCondition(item)));
  const joined = parts.join(group.combinator === 'and' ? ' and ' : ' or ');
  if (group.not) return `not (${joined})`;
  return nested && parts.length > 1 ? `(${joined})` : joined;
}

// The rule's logic in one line, with nested groups in brackets and inverted groups always as "not (…)" so they read unambiguously.
export function describeRule(rule) {
  return activeItems(rule.query).length ? describeGroup(rule.query, false) : 'No conditions yet';
}

// ---- Folder paths ----

// Resolves "Root/Sub/Folder" against the top-level folders; a path not starting with one goes under Other Bookmarks.
export function resolveTarget(target, rootFolders) {
  const segments = String(target ?? '').split('/').map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return null;
  const first = segments[0].toLowerCase();
  const byAlias = ROOT_ALIASES[first];
  const root = rootFolders.find((r) => r.id === byAlias || r.title.toLowerCase() === first);
  if (root) return { rootId: root.id, path: [root.title, ...segments.slice(1)], segments: segments.slice(1) };
  const other = rootFolders.find((r) => r.id === OTHER) ?? rootFolders[0];
  return { rootId: other.id, path: [other.title, ...segments], segments };
}

// A folder condition's folder as a path of titles; without the root folders to resolve it, the path as written.
export function folderPathOf(value, rootFolders) {
  if (rootFolders) return resolveTarget(value, rootFolders)?.path ?? null;
  const segments = value.split('/').map((s) => s.trim()).filter(Boolean);
  return segments.length ? segments : null;
}

export function startsWithPath(path, prefix) {
  return prefix.length <= path.length && prefix.every((seg, i) => path[i] === seg);
}

// Rules with every destination and folder condition under the folder at `from` pointed at `to` instead; the same list comes back when none named it.
export function moveRulePaths(rules, from, to, rootFolders) {
  const moved = (value) => {
    const path = resolveTarget(value, rootFolders)?.path;
    return path && startsWithPath(path, from) ? [...to, ...path.slice(from.length)].join('/') : null;
  };
  const inGroup = (group) => {
    let changed = false;
    const items = (group?.rules ?? []).map((item) => {
      const next = isGroup(item) ? inGroup(item) : FOLDER_OPS.has(item.operator) && valueOf(item) && moved(valueOf(item));
      if (!next) return item;
      changed = true;
      return isGroup(item) ? next : { ...item, value: next };
    });
    return changed ? { ...group, rules: items } : null;
  };
  let any = false;
  const out = rules.map((rule) => {
    const target = rule.target && moved(rule.target);
    const query = inGroup(rule.query);
    if (!target && !query) return rule;
    any = true;
    return { ...rule, ...(target ? { target } : {}), ...(query ? { query } : {}) };
  });
  return any ? out : rules;
}
