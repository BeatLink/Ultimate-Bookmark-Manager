// Organize rules: match bookmarks by title or address and plan moves into target folders.

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
  };
}

// Copies a rule under a new id so it can be edited separately; the copy's name is marked as such.
export function duplicateRule(rule) {
  const copy = structuredClone(rule);
  copy.id = crypto.randomUUID();
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

// A condition with no keywords is ignored, so a half-written rule never matches everything.
function activeConditions(rule) {
  return (rule.conditions ?? []).filter((c) => keywords(c).length);
}

export function ruleMatches(rule, bookmark) {
  const conds = activeConditions(rule);
  if (!conds.length) return false;
  return rule.match === 'all' ? conds.every((c) => conditionMatches(c, bookmark)) : conds.some((c) => conditionMatches(c, bookmark));
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

// Checks each rule once so the editor can show a problem next to the rule that has it.
export function validateRules(rules, rootFolders) {
  const problems = new Map();
  for (const rule of rules) {
    const issues = [];
    if (!activeConditions(rule).length) issues.push('Add at least one keyword to a condition.');
    if (!resolveTarget(rule.target, rootFolders)) issues.push('Choose a target folder.');
    for (const c of activeConditions(rule)) {
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

// Works out where each bookmark should go: the first enabled, valid rule that matches decides.
export function planMoves(flat, rules, rootFolders, ignoredIds = new Set()) {
  const problems = validateRules(rules, rootFolders);
  const usable = rules
    .filter((r) => r.enabled !== false && !problems.has(r.id))
    .map((rule) => ({ rule, target: resolveTarget(rule.target, rootFolders) }));
  const moves = [];
  for (const b of flat) {
    if (b.type !== 'bookmark' || ignoredIds.has(b.id)) continue;
    const hit = usable.find(({ rule }) => ruleMatches(rule, b));
    if (!hit || startsWithPath(b.path, hit.target.path)) continue;
    moves.push({ bookmark: b, ruleId: hit.rule.id, ruleName: hit.rule.name, target: hit.target });
  }
  return { moves, problems };
}
