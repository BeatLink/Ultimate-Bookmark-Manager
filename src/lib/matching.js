// Matches bookmarks against organize rules: whether a rule holds, how specific the match is, and what matched where.

import { valuePoints, URL_TIER } from './specificity.js';
import { bareDomain, onDomain } from './domains.js';
import { FOLDER_OPS, WORD_OPS, isGroup, valueOf, activeItems, folderPathOf, startsWithPath } from './rules.js';

// Parsed hosts and compiled patterns are remembered up to these counts, then forgotten and rebuilt as needed.
const HOST_CACHE_MAX = 50000;
const PATTERN_CACHE_MAX = 5000;

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
  if (hosts.size > HOST_CACHE_MAX) hosts.clear();
  hosts.set(url, host);
  return host;
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A letter or digit in any language; with "whole words" a keyword may not touch one on either side.
const WORD = '[\\p{L}\\p{N}]';
const wordChar = /[\p{L}\p{N}]/u;
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
    const before = whole && wordChar.test(value.at(0)) ? `(?<!${WORD})` : '';
    const after = whole && wordChar.test(value.at(-1)) ? `(?!${WORD})` : '';
    const flags = cond.caseSensitive ? 'gu' : 'giu';
    if (cond.operator === 'beginsWith') re = new RegExp(`^${v}${after}`, flags);
    else if (cond.operator === 'endsWith') re = new RegExp(`${before}${v}$`, flags);
    else if (cond.operator === '=') re = new RegExp(`^${v}$`, flags);
    else re = new RegExp(`${before}${v}${after}`, flags);
  }
  // Every keystroke in a rule's keyword makes a new pattern, so the cache starts over once it grows large.
  if (patterns.size > PATTERN_CACHE_MAX) patterns.clear();
  patterns.set(key, re);
  return re;
}

// Where a shared pattern matches in a text, as [start, end] pairs; empty when it does not.
function rangesOf(re, text) {
  // The pattern is shared, so start from the beginning whatever the last search left behind.
  re.lastIndex = 0;
  const out = [];
  for (const m of text.matchAll(re)) {
    if (m[0].length) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

// Where one keyword occurs in a text under a condition's operator and options.
export function occurrences(cond, value, text) {
  return rangesOf(patternFor(cond, value), text);
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

// Where the host sits in the URL when it is on the domain; empty otherwise.
function domainRanges(domain, url) {
  if (!onDomain(hostOf(url), domain)) return [];
  const part = urlPart(url, 'host');
  const end = part.start + part.text.length;
  // A site name written differently from how the browser reads it (such as in another script) is highlighted whole.
  return part.text.toLowerCase().endsWith(domain) ? [[end - domain.length, end]] : [[part.start, end]];
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

// Conditions aimed only at the URL rank in the URL tier; "title or URL" stays a keyword condition.
const tierFor = (fields) => (fields.includes('title') ? 1 : URL_TIER);

// A bookmark's title, URL and folder path, with each part of the URL split out once when first asked for.
function bookmarkText(bookmark) {
  const title = bookmark.title ?? '';
  const url = bookmark.url ?? '';
  const parts = {};
  const partAt = (on) => (on === 'title' ? { text: title, start: 0 } : on === 'url' ? { text: url, start: 0 } : (parts[on] ??= urlPart(url, on)));
  return { url, path: bookmark.path ?? [], partAt, part: (on) => partAt(on).text };
}

// A condition prepared once per plan: which parts of a bookmark it reads, a quick test of one part, and where it matched.
function compileCondition(cond, rootFolders) {
  const value = valueOf(cond);
  const op = cond.operator;
  if (FOLDER_OPS.has(op)) {
    const path = folderPathOf(value, rootFolders);
    const inside = (p) => !!path && startsWithPath(p, path) && (op === 'inFolder' || p.length === path.length);
    return { op, folder: true, holds: (text) => inside(text.path) };
  }
  const fields = fieldsOf(cond);
  const compiled = { op, value, fields, tier: tierFor(fields) };
  if (op === 'onDomain') {
    const domain = bareDomain(value);
    compiled.hit = (text) => onDomain(hostOf(text.url), domain);
    compiled.ranges = (text) => domainRanges(domain, text.url);
  } else if (op === 'hasParam') {
    compiled.ranges = (text) => paramRanges(cond, value, text.url);
    compiled.hit = (text) => compiled.ranges(text).length > 0;
  } else {
    const re = patternFor(cond, value);
    compiled.hit = (text, on) => {
      re.lastIndex = 0;
      const found = re.test(text.part(on));
      re.lastIndex = 0;
      return found;
    };
    compiled.ranges = (text, on) => {
      const part = text.partAt(on);
      return rangesOf(re, part.text).map(([s, e]) => [s + part.start, e + part.start]);
    };
  }
  return compiled;
}

// A rule's conditions prepared once per plan, with inactive items already dropped.
function compileGroup(group, rootFolders) {
  const items = activeItems(group).map((item) => (isGroup(item) ? compileGroup(item, rootFolders) : compileCondition(item, rootFolders)));
  return { combinator: group.combinator, not: !!group.not, items };
}

// The specificity of a condition's match, or null when it does not hold.
function conditionScore(c, text) {
  if (c.folder) return c.holds(text) ? 0 : null;
  // "Does not contain" on the title and URL must hold for both.
  if (c.op === 'doesNotContain') return c.fields.every((on) => !c.hit(text, on)) ? 0 : null;
  const on = c.fields.find((f) => c.hit(text, f));
  return on ? valuePoints(c.op, c.value, on) * c.tier : null;
}

// What made a condition hold, as the keyword and where it matched; null when it does not hold, empty for folder and "does not contain" conditions.
function conditionHits(c, text) {
  if (conditionScore(c, text) === null) return null;
  if (c.folder || c.op === 'doesNotContain') return [];
  return c.fields.map((on) => ({ value: c.value, on, ranges: c.ranges(text, on) })).filter((hit) => hit.ranges.length);
}

// What a group contributes when it holds, or null: `leaf` evaluates one condition and `join` combines the parts that held.
function evalGroup(group, text, leaf, join) {
  const results = group.items.map((item) => (item.items ? evalGroup(item, text, leaf, join) : leaf(item, text)));
  const held = results.filter((x) => x !== null);
  const holds = group.combinator === 'and' ? held.length === results.length : held.length > 0;
  // An inverted group contributes nothing when it holds, as what it rules out is not a match.
  if (group.not) return holds ? null : join([]);
  return holds ? join(held) : null;
}

const sum = (scores) => scores.reduce((a, b) => a + b, 0);
const flat = (lists) => lists.flat();

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

// The keywords that matched and where, plus merged ranges to highlight in the title and the URL.
function summarize(hits) {
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

// A rule prepared for many bookmarks: `score` is the specificity of a match or null, and `explain` says what matched.
export function matcher(rule, rootFolders) {
  const compiled = compileGroup(rule.query ?? {}, rootFolders);
  if (!compiled.items.length) return { score: () => null, explain: () => null };
  return {
    score: (bookmark) => evalGroup(compiled, bookmarkText(bookmark), conditionScore, sum),
    explain: (bookmark) => {
      const hits = evalGroup(compiled, bookmarkText(bookmark), conditionHits, flat);
      return hits && summarize(hits);
    },
  };
}

export function ruleMatches(rule, bookmark, rootFolders) {
  return matcher(rule, rootFolders).score(bookmark) !== null;
}

// Why a rule matched a bookmark, or null when it does not match.
export function explainMatch(rule, bookmark, rootFolders) {
  return matcher(rule, rootFolders).explain(bookmark);
}

// The most a rule can score: every condition it lists matching, in the part of the bookmark worth the most.
export function maxScore(rule) {
  const cond = (c) => {
    if (FOLDER_OPS.has(c.operator) || c.operator === 'doesNotContain') return 0;
    const fields = fieldsOf(c);
    return Math.max(...fields.map((f) => valuePoints(c.operator, valueOf(c), f))) * tierFor(fields);
  };
  const group = (g) => (g.not ? 0 : activeItems(g).reduce((total, item) => total + (isGroup(item) ? group(item) : cond(item)), 0));
  return group(rule.query);
}
