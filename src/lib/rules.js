// Rules: their conditions and actions, how they are built, edited, read from older saves, described and pointed at folders.

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

// What a rule can do to a bookmark it matches, in the order the menu lists them.
export const ACTIONS = {
  move: 'Move to folder',
  replace: 'Find and replace',
  pageTitle: 'Rename to page title',
  redirect: 'Use redirect target',
  ignore: 'Ignore',
  delete: 'Delete',
};

// Which bookmark fields each choice of a replace action's "Look in" changes.
export const LOOK_IN = { both: 'names and URLs', title: 'names', url: 'URLs' };

// A move remembers its folder by id, so a renamed or moved folder keeps its rules, and by path, to find or create it when the id is gone.
export function newAction(type = 'move') {
  const action = { id: crypto.randomUUID(), type };
  if (type === 'move') return { ...action, folderId: '', path: '' };
  if (type === 'replace') return { ...action, find: '', replace: '', field: 'both', caseSensitive: false, regex: false };
  return action;
}

export function newRule() {
  return {
    id: crypto.randomUUID(),
    name: '',
    enabled: true,
    // Whether the rule also runs on each new bookmark a few seconds after it is added.
    autoRun: false,
    query: newGroup(),
    actions: [newAction()],
    createdAt: Date.now(),
  };
}

// A copy of a condition or group under new ids, as the editor needs every id on the page to be unique.
export function renumber(item) {
  return { ...structuredClone(item), id: crypto.randomUUID(), ...(isGroup(item) && { rules: item.rules.map(renumber) }) };
}

const renumberActions = (actions) => (actions ?? []).map((a) => ({ ...structuredClone(a), id: crypto.randomUUID() }));

// Copies a rule under a new id so it can be edited separately; the copy's name is marked as such.
export function duplicateRule(rule) {
  const copy = structuredClone(rule);
  copy.id = crypto.randomUUID();
  copy.createdAt = Date.now();
  copy.name = rule.name ? `${rule.name} (copy)` : '';
  copy.query = renumber(copy.query);
  copy.actions = renumberActions(copy.actions);
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

// Moves a condition or group into a new rule placed after its old one, with the same actions and scoping folder conditions; null when the item is not in the rule.
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
    autoRun: rule.autoRun,
    query,
    actions: renumberActions(rule.actions),
  };
  const out = rules.map((r) => (r.id === ruleId ? { ...r, query: without(r.query, itemId) } : r));
  out.splice(out.findIndex((r) => r.id === ruleId) + 1, 0, part);
  return { rules: out, part };
}

// Merges `otherId` into `keepId`, which then matches whatever either matched and keeps its own actions; returns the rules without the other.
export function mergeRules(rules, keepId, otherId) {
  const keep = rules.find((r) => r.id === keepId);
  const other = rules.find((r) => r.id === otherId);
  if (!keep || !other || keep === other) return rules;
  // "Any" groups that are not inverted are joined directly rather than nested.
  const parts = [keep.query, other.query].flatMap((q) => (q.combinator === 'or' && !q.not ? q.rules : [q]));
  return rules.filter((r) => r !== other).map((r) => (r === keep ? { ...keep, query: newGroup(parts) } : r));
}

// The list with the item at `from` moved to position `to`, as rules and their actions run in list order.
export function reorder(list, from, to) {
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item);
  return out;
}

// ---- Rules saved in older shapes ----

const OLD_OPERATORS = { notContains: 'doesNotContain', containsAll: 'contains', startsWith: 'beginsWith', equals: '=', domain: 'onDomain', param: 'hasParam', regex: 'matchesRegex' };
const OLD_FIELDS = { domain: 'host', param: 'query' };
// Fields older versions saved on a rule and this one ignores; rules now run in list order instead of by ranking.
const RETIRED_FIELDS = ['priority', 'fallback', 'catchAll', 'outranks', 'rankAll'];

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

// An old condition list as a query, with its source folders as folder conditions.
function migrateConditions(rule) {
  const { match, conditions, sources, sourceSubfolders } = rule;
  let query = migrateGroup({ match, conditions });
  const folders = (sources ?? []).map((path) => newCondition('folder', sourceSubfolders === false ? 'directlyInFolder' : 'inFolder', path));
  if (folders.length) {
    const scope = folders.length === 1 ? folders[0] : newGroup(folders);
    if (!query.rules.length) query = isGroup(scope) ? scope : newGroup([scope]);
    else if (query.combinator === 'and' && !query.not) query = { ...query, rules: [scope, ...query.rules] };
    else query = newGroup([scope, query], 'and');
  }
  return query;
}

// A rule as this version reads it: an old condition list becomes a query, a target folder a move action that runs on new bookmarks when `autoRun` says so, and retired fields go; a current rule comes back unchanged.
export function migrateRule(rule, { autoRun = false } = {}) {
  const retired = RETIRED_FIELDS.filter((key) => key in rule);
  if (rule.query && rule.actions && !retired.length) return rule;
  const rest = { ...rule };
  for (const key of [...retired, 'match', 'conditions', 'sources', 'sourceSubfolders']) delete rest[key];
  if (!rule.query) rest.query = migrateConditions(rule);
  if (!rule.actions) {
    delete rest.target;
    rest.actions = [{ ...newAction('move'), path: typeof rule.target === 'string' ? rule.target : '' }];
    rest.autoRun = autoRun;
  }
  return rest;
}

const isAction = (a) => a !== null && typeof a === 'object' && typeof a.id === 'string' && Object.hasOwn(ACTIONS, a.type)
  && (a.type !== 'move' || (typeof a.path === 'string' && typeof a.folderId === 'string'))
  && (a.type !== 'replace' || (typeof a.find === 'string' && typeof a.replace === 'string' && Object.hasOwn(LOOK_IN, a.field)));

// True when a rule has the shape the planner reads: an id, a tree of groups and conditions, and a list of known actions.
export function isWellFormedRule(rule) {
  const isCondition = (x) => typeof x.field === 'string' && typeof x.operator === 'string';
  const isItem = (x) => x !== null && typeof x === 'object' && (isGroup(x) ? x.rules.every(isItem) : isCondition(x));
  return typeof rule?.id === 'string' && isGroup(rule.query) && rule.query.rules.every(isItem)
    && Array.isArray(rule.actions) && rule.actions.every(isAction);
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

// One action in plain words, e.g. `Move to “Other Bookmarks › Dev”` or `Replace “http:” with “https:” in URLs`.
export function describeAction(action) {
  if (action.type === 'move') return action.path ? `Move to “${folderLabel(action.path)}”` : 'Move to a folder not chosen yet';
  if (action.type === 'replace') return `Replace “${action.find}” with “${action.replace}” in ${LOOK_IN[action.field] ?? LOOK_IN.both}`;
  return ACTIONS[action.type] ?? action.type;
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

// Rules with every move and folder condition under the folder at `from` pointed at `to` instead; the same list comes back when none named it.
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
    let movedAction = false;
    const actions = rule.actions.map((a) => {
      const path = a.type === 'move' && a.path && moved(a.path);
      if (!path) return a;
      movedAction = true;
      return { ...a, path };
    });
    const query = inGroup(rule.query);
    if (!movedAction && !query) return rule;
    any = true;
    return { ...rule, ...(movedAction ? { actions } : {}), ...(query ? { query } : {}) };
  });
  return any ? out : rules;
}

// Each folder's id with its path of titles from the top-level folder down, from a flattened tree.
export function folderPaths(flat) {
  return new Map(flat.filter((n) => n.type === 'folder').map((n) => [n.id, [...n.path, n.title]]));
}

// Where a move action files a bookmark: its folder by id while that exists, otherwise its path, created when missing; null without a folder.
export function resolveMove(action, folders, rootFolders) {
  const path = action.folderId && folders.get(action.folderId);
  if (path) return { folderId: action.folderId, path };
  return resolveTarget(action.path, rootFolders);
}

// The folder with this path ("Other Bookmarks/Dev") in the tree, or null.
export function findFolderId(root, key) {
  let node = root;
  for (const title of String(key ?? '').split('/')) {
    node = (node?.children ?? []).find((c) => !c.url && (c.title ?? '') === title && c.type !== 'separator');
  }
  return node && node !== root ? node.id : null;
}

// The path ("Other Bookmarks/Dev") of the folder with this id in the tree, or null.
export function folderPathById(root, id) {
  const walk = (node, path) => {
    for (const child of node.children ?? []) {
      if (child.url || child.type === 'separator') continue;
      const own = [...path, child.title ?? ''];
      if (child.id === id) return own.join('/');
      const inner = walk(child, own);
      if (inner) return inner;
    }
    return null;
  };
  return walk(root, []);
}

// The group with each folder condition's path brought up to date from its folder id; null when none changed.
function refreshGroupPaths(group, folders) {
  let changed = false;
  const items = (group?.rules ?? []).map((item) => {
    if (isGroup(item)) {
      const inner = refreshGroupPaths(item, folders);
      if (!inner) return item;
      changed = true;
      return inner;
    }
    const path = FOLDER_OPS.has(item.operator) && item.folderId && folders.get(item.folderId)?.join('/');
    if (!path || path === item.value) return item;
    changed = true;
    return { ...item, value: path };
  });
  return changed ? { ...group, rules: items } : null;
}

// Rules with each move's path and folder condition's folder brought up to date from its folder id, so the path still finds the folder after a rename elsewhere; the same list comes back when none changed.
export function refreshMovePaths(rules, folders) {
  let any = false;
  const out = rules.map((rule) => {
    let changed = false;
    const actions = rule.actions.map((a) => {
      const path = a.type === 'move' && a.folderId && folders.get(a.folderId)?.join('/');
      if (!path || path === a.path) return a;
      changed = true;
      return { ...a, path };
    });
    const query = refreshGroupPaths(rule.query, folders);
    if (!changed && !query) return rule;
    any = true;
    return { ...rule, ...(changed ? { actions } : {}), ...(query ? { query } : {}) };
  });
  return any ? out : rules;
}
