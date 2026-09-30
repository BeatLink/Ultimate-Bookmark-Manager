// Organize rules: match bookmarks by title, address or part of the address and plan moves into target folders.

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
  param: 'has query parameter',
  regex: 'matches any regex',
};

export const FIELDS = {
  either: 'title or address',
  title: 'title',
  url: 'address',
  host: 'site name',
  path: 'address path',
  query: 'query string',
  fragment: 'part after #',
};

// Operators that always look at the address, so the field choice does not apply to them.
export const ADDRESS_OPS = new Set(['domain', 'param']);

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
  return { field: 'either', op: 'contains', values: [], caseSensitive: false, wholeWords: true };
}

// Operators where "whole words" applies; domains, regexes and exact matches already have their own edges.
export const WORD_OPS = new Set(['contains', 'containsAll', 'notContains', 'startsWith', 'endsWith']);

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

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A letter or digit in any language; with "whole words" a keyword may not touch one on either side.
const WORD = '[\\p{L}\\p{N}]';
const patterns = new Map();

// The pattern for one keyword under a condition's operator and options, built once and reused.
function patternFor(cond, value) {
  const whole = cond.wholeWords && WORD_OPS.has(cond.op);
  const key = `${cond.op}|${cond.caseSensitive ? 1 : 0}|${whole ? 1 : 0}|${value}`;
  if (patterns.has(key)) return patterns.get(key);
  let re;
  if (cond.op === 'regex') {
    re = new RegExp(value, cond.caseSensitive ? 'g' : 'gi');
  } else {
    const v = escapeRe(value);
    // An edge is only enforced where the keyword itself starts or ends with a letter or digit, so "/a" or "c++" still match.
    const wordChar = /[\p{L}\p{N}]/u;
    const before = whole && wordChar.test(value.at(0)) ? `(?<!${WORD})` : '';
    const after = whole && wordChar.test(value.at(-1)) ? `(?!${WORD})` : '';
    const flags = cond.caseSensitive ? 'gu' : 'giu';
    if (cond.op === 'startsWith') re = new RegExp(`^${v}${after}`, flags);
    else if (cond.op === 'endsWith') re = new RegExp(`${before}${v}$`, flags);
    else if (cond.op === 'equals') re = new RegExp(`^${v}$`, flags);
    else re = new RegExp(`${before}${v}${after}`, flags);
  }
  patterns.set(key, re);
  return re;
}

// Where one keyword occurs in a text, as [start, end] pairs; empty when it does not occur.
export function occurrences(cond, value, text) {
  const re = patternFor(cond, value);
  const out = [];
  for (const m of text.matchAll(re)) {
    if (!m[0].length) continue;
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

// Splits an address as written into site name, path, query string and fragment (RFC 3986, appendix B).
const URL_SHAPE = /^(?:[a-z][a-z0-9+.-]*:)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/dis;

// One part of an address and where it starts in it, so highlights land on the address as shown; empty when absent.
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

// The parts of a bookmark a condition looks at: the title, the whole address or one part of it.
function fieldsOf(cond) {
  if (ADDRESS_OPS.has(cond.op)) return ['url'];
  return !cond.field || cond.field === 'either' ? ['title', 'url'] : [cond.field];
}

// Where one keyword occurs in one part of a bookmark, as ranges in the title (for "title") or else in the address.
// Throws on an invalid regex so callers can report it.
function rangesIn(cond, value, bookmark, on) {
  const url = bookmark.url ?? '';
  if (cond.op === 'domain') return domainRanges(value, url);
  if (cond.op === 'param') return paramRanges(cond, value, url);
  if (on === 'title') return occurrences(cond, value, bookmark.title ?? '');
  const part = urlPart(url, on);
  return occurrences(cond, value, part.text).map(([s, e]) => [s + part.start, e + part.start]);
}

export function conditionMatches(cond, bookmark) {
  const words = keywords(cond);
  if (!words.length) return false;
  const fields = fieldsOf(cond);
  const has = (on) => (w) => rangesIn(cond, w, bookmark, on).length > 0;
  // "Contains none of" on several fields must hold for all of them; "contains all of" needs every keyword in one field.
  if (cond.op === 'notContains') return fields.every((on) => !words.some(has(on)));
  if (cond.op === 'containsAll') return fields.some((on) => words.every(has(on)));
  return fields.some((on) => words.some(has(on)));
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
  const fields = fieldsOf(cond);
  const one = (value, on) => rangesIn(cond, value, bookmark, on).length > 0;
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
    return keywords(c).reduce((sum, v) => sum + Math.max(...fieldsOf(c).map((f) => valuePoints(c.op, v, f))), 0);
  };
  const group = (g) => (g.match === 'none' ? 0 : activeItems(g).reduce((sum, item) => sum + (isGroup(item) ? group(item) : cond(item)), 0));
  return group(rule);
}

// What made a condition hold: each keyword that matched, where, and the character ranges to highlight.
// Null when the condition does not hold; an empty list for a "contains none of" that holds.
function conditionHits(cond, bookmark) {
  if (!conditionMatches(cond, bookmark)) return null;
  if (cond.op === 'notContains') return [];
  const hits = [];
  for (const value of keywords(cond)) {
    for (const on of fieldsOf(cond)) {
      const ranges = rangesIn(cond, value, bookmark, on);
      // A query parameter is reported as found in the query string, everything else in the part it looked at.
      if (ranges.length) hits.push({ value, on: cond.op === 'param' ? 'query' : on, ranges });
    }
  }
  return hits;
}

function groupHits(group, bookmark) {
  const parts = activeItems(group).map((item) => (isGroup(item) ? groupHits(item, bookmark) : conditionHits(item, bookmark)));
  if (group.match === 'all') return parts.includes(null) ? null : parts.flat();
  if (group.match === 'none') return parts.every((x) => x === null) ? [] : null;
  const hit = parts.filter((x) => x !== null);
  return hit.length ? hit.flat() : null;
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
// title and the address. Null when the rule does not match; a catch-all matches with nothing to show.
export function explainMatch(rule, bookmark) {
  if (rule.catchAll) return { terms: [], title: [], url: [] };
  if (!activeItems(rule).length) return null;
  const hits = groupHits(rule, bookmark);
  if (!hits) return null;
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
export function ruleScore(rule, bookmark) {
  if (rule.catchAll) return CATCH_ALL_SCORE;
  return activeItems(rule).length ? groupScore(rule, bookmark) : null;
}

// Normal rules outrank fallback rules, which outrank catch-alls; priority still comes first.
export function tierOf(rule) {
  if (rule.catchAll) return 0;
  return rule.fallback ? 1 : 2;
}

// Whether candidate `a` beats `b`: higher priority, then a normal rule over a fallback over a catch-all,
// then the more specific match, then the newer rule.
export function beats(a, b) {
  const pa = Number(a.rule.priority) || 0;
  const pb = Number(b.rule.priority) || 0;
  if (pa !== pb) return pa > pb;
  const ta = tierOf(a.rule);
  const tb = tierOf(b.rule);
  if (ta !== tb) return ta > tb;
  if (a.score !== b.score) return a.score > b.score;
  const ca = a.rule.createdAt ?? 0;
  const cb = b.rule.createdAt ?? 0;
  if (ca !== cb) return ca > cb;
  // Rules saved before creation times were recorded: later in the list counts as newer.
  return a.index > b.index;
}

// Why a matching rule ranks below the winner, in terms of the first thing that separates them.
export function lostBecause(loser, winner) {
  const pl = Number(loser.rule.priority) || 0;
  const pw = Number(winner.rule.priority) || 0;
  if (pl !== pw) return `lower priority (${pl} vs ${pw})`;
  if (tierOf(loser.rule) !== tierOf(winner.rule)) {
    return loser.rule.catchAll ? 'catch-alls only take what no other rule matches' : 'fallback rules give way to normal rules';
  }
  if (loser.score !== winner.score) return `less specific (${loser.score} vs ${winner.score})`;
  if ((loser.rule.createdAt ?? 0) !== (winner.rule.createdAt ?? 0)) return 'older rule, equally specific';
  return 'earlier in the list, equally specific';
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
  const subject = ADDRESS_OPS.has(cond.op) ? 'address' : FIELDS[cond.field] ?? FIELDS.either;
  // Matching inside words is the risky setting ("cat" in "category"), so the summary says when it is on.
  const inside = WORD_OPS.has(cond.op) && !cond.wholeWords ? ' (also inside words)' : '';
  return `${subject} ${OPERATORS[cond.op] ?? cond.op} ${list}${cond.caseSensitive && cond.op !== 'domain' ? ' (exact case)' : ''}${inside}`;
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
    const candidates = [];
    for (const u of usable) {
      if (!inScope(u.sources, u.rule.sourceSubfolders !== false, b)) continue;
      const score = ruleScore(u.rule, b);
      if (score === null) continue;
      const candidate = { ...u, score };
      candidates.push(candidate);
      if (!best || beats(candidate, best)) best = candidate;
    }
    if (!best) continue;
    const matched = candidates.length;
    wins.set(best.rule.id, (wins.get(best.rule.id) ?? 0) + 1);
    // The winning rule decides even when the bookmark is already where it says, so a weaker rule cannot move it away.
    if (startsWithPath(b.path, best.target.path)) continue;
    moves.push({ bookmark: b, ruleId: best.rule.id, ruleName: best.rule.name, target: best.target, score: best.score, priority: Number(best.rule.priority) || 0, fallback: !!best.rule.fallback, others: matched - 1, why: explainMatch(best.rule, b),
      // Every matching rule, strongest first, each with what it matched and, below the winner, why it lost.
      ranking: candidates
        .sort((x, y) => (beats(x, y) ? -1 : beats(y, x) ? 1 : 0))
        .map((c) => ({
          ruleId: c.rule.id, ruleName: c.rule.name, target: c.target, score: c.score, priority: Number(c.rule.priority) || 0,
          fallback: !!c.rule.fallback, catchAll: !!c.rule.catchAll, why: explainMatch(c.rule, b), lost: c === best ? null : lostBecause(c, best),
        })) });
  }
  return { moves, problems, wins };
}
