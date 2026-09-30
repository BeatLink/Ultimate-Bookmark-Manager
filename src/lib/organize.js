// Organize rules: match bookmarks by title or address and plan moves into target folders.

import { byText } from './text.js';
import { valuePoints, CATCH_ALL_SCORE } from './specificity.js';

export const OPERATORS = {
  contains: 'contains any of',
  containsAll: 'contains all of',
  notContains: 'contains none of',
  startsWith: 'starts with',
  endsWith: 'ends with',
  equals: 'is exactly',
  domain: 'is on domain',
  regex: 'matches any regex',
};

export const FIELDS = { either: 'title or address', title: 'title', url: 'address' };

// Short names accepted as the first segment of a target path, alongside the root folders' own titles.
const ROOT_ALIASES = {
  menu: 'menu________',
  toolbar: 'toolbar_____',
  other: 'unfiled_____',
  unfiled: 'unfiled_____',
  mobile: 'mobile______',
};

// How a group combines its items; "none" is true when none of them are.
export const MODES = { any: 'any', all: 'all', none: 'none' };

export function newGroup() {
  return { type: 'group', match: 'any', conditions: [newCondition()] };
}

export function isGroup(item) {
  return item?.type === 'group';
}

export function newCondition() {
  return { field: 'either', op: 'contains', values: [], caseSensitive: false };
}

export function newRule() {
  return {
    id: crypto.randomUUID(),
    name: '',
    enabled: true,
    match: 'any',
    conditions: [newCondition()],
    target: '',
    sources: [],
    sourceSubfolders: true,
    // Compared before specificity, so a higher number makes this rule win regardless.
    priority: 0,
    createdAt: Date.now(),
  };
}

// Copies a rule under a new id so it can be edited separately; the copy's name is marked as such.
// A rule with no conditions that takes whatever no other rule matches in the folders it looks in; it always runs last.
export function newCatchAll(sources = []) {
  return { ...newRule(), catchAll: true, conditions: [], sources, sourceSubfolders: false };
}

export function duplicateRule(rule) {
  const copy = structuredClone(rule);
  copy.id = crypto.randomUUID();
  copy.createdAt = Date.now();
  copy.name = rule.name ? `${rule.name} (copy)` : '';
  return copy;
}

// The condition's keywords; a plain comma-separated `value` string is still read for older rules.
export function keywords(cond) {
  const list = Array.isArray(cond.values) ? cond.values : String(cond.value ?? '').split(',');
  return list.map((t) => String(t).trim()).filter(Boolean);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Tests one condition against one text; throws on an invalid regex so callers can report it.
function testText(cond, text, url) {
  if (cond.op === 'regex') return keywords(cond).some((p) => new RegExp(p, cond.caseSensitive ? '' : 'i').test(text));
  if (cond.op === 'domain') {
    const host = hostOf(url);
    return keywords(cond).some((d) => {
      const dom = d.toLowerCase().replace(/^\*?\./, '');
      return host === dom || host.endsWith('.' + dom);
    });
  }
  const fold = (s) => (cond.caseSensitive ? s : s.toLowerCase());
  const hay = fold(text);
  const words = keywords(cond).map(fold);
  if (!words.length) return false;
  switch (cond.op) {
    case 'contains': return words.some((w) => hay.includes(w));
    case 'containsAll': return words.every((w) => hay.includes(w));
    case 'notContains': return !words.some((w) => hay.includes(w));
    case 'startsWith': return words.some((w) => hay.startsWith(w));
    case 'endsWith': return words.some((w) => hay.endsWith(w));
    case 'equals': return words.some((w) => hay === w);
    default: return false;
  }
}

export function conditionMatches(cond, bookmark) {
  if (cond.op === 'domain') return testText(cond, '', bookmark.url);
  const title = bookmark.title ?? '';
  const url = bookmark.url ?? '';
  if (cond.field === 'title') return testText(cond, title, url);
  if (cond.field === 'url') return testText(cond, url, url);
  // "Contains none of" on either field must hold for both, the rest need only one.
  return cond.op === 'notContains'
    ? testText(cond, title, url) && testText(cond, url, url)
    : testText(cond, title, url) || testText(cond, url, url);
}

// A rule is itself a group: `match` says how its `conditions` combine, and each of those may be a nested group.
// Conditions without keywords and groups with nothing active are ignored, so a half-written rule never matches everything.
function activeItems(group) {
  return (group.conditions ?? []).filter((item) => (isGroup(item) ? activeItems(item).length : keywords(item).length));
}

function allConditions(group) {
  return (group.conditions ?? []).flatMap((item) => (isGroup(item) ? allConditions(item) : [item]));
}

// The specificity of a condition's match, or null when it does not hold; only the keywords that matched count.
function conditionScore(cond, bookmark) {
  if (cond.op === 'notContains') return conditionMatches(cond, bookmark) ? 0 : null;
  const fields = cond.op === 'domain' ? ['url'] : cond.field === 'either' || !cond.field ? ['title', 'url'] : [cond.field];
  const text = { title: bookmark.title ?? '', url: bookmark.url ?? '' };
  const one = (value, on) => testText({ ...cond, values: [value] }, cond.op === 'domain' ? '' : text[on], text.url);
  const values = keywords(cond);
  if (cond.op === 'containsAll') {
    // Every keyword has to be in the same part of the bookmark.
    return fields.some((on) => values.every((v) => one(v, on))) ? values.length * valuePoints('containsAll', '', 'title') : null;
  }
  let score = null;
  for (const v of values) {
    const on = fields.find((f) => one(v, f));
    if (on) score = (score ?? 0) + valuePoints(cond.op, v, on);
  }
  return score;
}

function groupScore(group, bookmark) {
  const scores = activeItems(group).map((item) => (isGroup(item) ? groupScore(item, bookmark) : conditionScore(item, bookmark)));
  if (group.match === 'all') return scores.includes(null) ? null : scores.reduce((a, b) => a + b, 0);
  if (group.match === 'none') return scores.every((x) => x === null) ? 0 : null;
  const hits = scores.filter((x) => x !== null);
  return hits.length ? hits.reduce((a, b) => a + b, 0) : null;
}

// The most a rule can score: every keyword it lists matching, in the part of the bookmark worth the most.
export function maxScore(rule) {
  if (rule.catchAll) return CATCH_ALL_SCORE;
  const cond = (c) => {
    if (c.op === 'notContains') return 0;
    const on = c.op === 'domain' || c.field === 'url' ? ['url'] : c.field === 'title' ? ['title'] : ['title', 'url'];
    return keywords(c).reduce((sum, v) => sum + Math.max(...on.map((f) => valuePoints(c.op, v, f))), 0);
  };
  const group = (g) => (g.match === 'none' ? 0 : activeItems(g).reduce((sum, item) => sum + (isGroup(item) ? group(item) : cond(item)), 0));
  return group(rule);
}

// How specifically the rule matches the bookmark, or null when it does not match at all.
export function ruleScore(rule, bookmark) {
  if (rule.catchAll) return CATCH_ALL_SCORE;
  return activeItems(rule).length ? groupScore(rule, bookmark) : null;
}

// Whether candidate `a` beats `b`: higher priority, then more specific, then the newer rule.
export function beats(a, b) {
  const pa = Number(a.rule.priority) || 0;
  const pb = Number(b.rule.priority) || 0;
  if (pa !== pb) return pa > pb;
  if (a.score !== b.score) return a.score > b.score;
  const ca = a.rule.createdAt ?? 0;
  const cb = b.rule.createdAt ?? 0;
  if (ca !== cb) return ca > cb;
  // Rules saved before creation times were recorded: later in the list counts as newer.
  return a.index > b.index;
}

function groupMatches(group, bookmark) {
  const test = (item) => (isGroup(item) ? groupMatches(item, bookmark) : conditionMatches(item, bookmark));
  const items = activeItems(group);
  if (group.match === 'all') return items.every(test);
  if (group.match === 'none') return !items.some(test);
  return items.some(test);
}

export function ruleMatches(rule, bookmark) {
  if (rule.catchAll) return true;
  return activeItems(rule).length > 0 && groupMatches(rule, bookmark);
}

// One condition in plain words, e.g. `title contains any of “rust”, “cargo”`.
export function describeCondition(cond) {
  const list = keywords(cond).sort(byText).map((w) => `“${w}”`).join(', ');
  const subject = cond.op === 'domain' ? 'address' : FIELDS[cond.field] ?? FIELDS.either;
  return `${subject} ${OPERATORS[cond.op] ?? cond.op} ${list}${cond.caseSensitive && cond.op !== 'domain' ? ' (exact case)' : ''}`;
}

function describeGroup(group, nested) {
  const parts = activeItems(group).map((item) => (isGroup(item) ? describeGroup(item, true) : describeCondition(item)));
  const joined = parts.join(group.match === 'all' ? ' and ' : ' or ');
  if (group.match === 'none') return `not (${joined})`;
  return nested && parts.length > 1 ? `(${joined})` : joined;
}

// The rule's logic in one line, with nested groups in brackets and "none" groups always as "not (…)" so they read unambiguously.
export function describeRule(rule) {
  if (rule.catchAll) return 'Anything no other rule matches';
  return activeItems(rule).length ? describeGroup(rule, false) : 'No conditions yet';
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

// The folders a rule looks in, as resolved paths; an empty list means it looks everywhere.
function resolveSources(rule, rootFolders) {
  return (rule.sources ?? []).map((s) => resolveTarget(s, rootFolders)).filter(Boolean);
}

// Whether a bookmark sits in one of the rule's source folders, or anywhere when it has none.
function inScope(sources, subfolders, bookmark) {
  if (!sources.length) return true;
  return sources.some((s) => (subfolders ? startsWithPath(bookmark.path, s.path) : bookmark.path.length === s.path.length && startsWithPath(bookmark.path, s.path)));
}

// Whether the rule's conditions match the bookmark and it lies within the rule's source folders.
export function ruleApplies(rule, bookmark, rootFolders) {
  return inScope(resolveSources(rule, rootFolders), rule.sourceSubfolders !== false, bookmark) && ruleMatches(rule, bookmark);
}

// Checks each rule once so the editor can show a problem next to the rule that has it; source folders are checked only when `flat` is given.
export function validateRules(rules, rootFolders, flat = null) {
  const problems = new Map();
  const folders = flat && new Set(flat.filter((n) => n.type === 'folder').map((n) => [...n.path, n.title].join('\0')));
  for (const rule of rules) {
    const issues = [];
    if (rule.catchAll) {
      if (!(rule.sources ?? []).length) issues.push('A catch-all rule must look in at least one folder, or it would move every bookmark you have.');
    } else if (!activeItems(rule).length) {
      issues.push('Add at least one keyword to a condition.');
    }
    if (!resolveTarget(rule.target, rootFolders)) issues.push('Choose a target folder.');
    if (folders) {
      for (const s of resolveSources(rule, rootFolders)) {
        if (!folders.has(s.path.join('\0'))) issues.push(`The folder “${s.path.join(' › ')}” to look in no longer exists.`);
      }
    }
    for (const c of allConditions(rule)) {
      if (c.op !== 'regex') continue;
      for (const pattern of keywords(c)) {
        try {
          new RegExp(pattern);
        } catch (err) {
          issues.push(`Invalid regex “${pattern}”: ${err.message}`);
        }
      }
    }
    if (issues.length) problems.set(rule.id, issues);
  }
  return problems;
}

// Works out where each bookmark should go. Of the enabled, valid rules that match it and look in its folder,
// the one with the highest priority wins, then the most specific match, then the newest rule.
// `tree` is the whole flattened tree, used to check source folders exist when `flat` holds only some bookmarks.
export function planMoves(flat, rules, rootFolders, ignoredIds = new Set(), tree = flat) {
  const problems = validateRules(rules, rootFolders, tree);
  const usable = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled !== false && !problems.has(rule.id))
    .map((u) => ({ ...u, target: resolveTarget(u.rule.target, rootFolders), sources: resolveSources(u.rule, rootFolders) }));
  const moves = [];
  const wins = new Map();
  for (const b of flat) {
    if (b.type !== 'bookmark' || ignoredIds.has(b.id)) continue;
    let best = null;
    let matched = 0;
    for (const u of usable) {
      if (!inScope(u.sources, u.rule.sourceSubfolders !== false, b)) continue;
      const score = ruleScore(u.rule, b);
      if (score === null) continue;
      matched++;
      const candidate = { ...u, score };
      if (!best || beats(candidate, best)) best = candidate;
    }
    if (!best) continue;
    wins.set(best.rule.id, (wins.get(best.rule.id) ?? 0) + 1);
    // The winning rule decides even when the bookmark is already where it says, so a weaker rule cannot move it away.
    if (startsWithPath(b.path, best.target.path)) continue;
    moves.push({ bookmark: b, ruleId: best.rule.id, ruleName: best.rule.name, target: best.target, score: best.score, priority: Number(best.rule.priority) || 0, others: matched - 1 });
  }
  return { moves, problems, wins };
}
