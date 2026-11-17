// Find and replace text in bookmark names and URLs, with where each match was and where its replacement lands.

// Which bookmark fields each choice of "Look in" searches.
export const FIELDS = { both: ['title', 'url'], title: ['title'], url: ['url'] };

// The search as a global regex, or null while there is nothing to find; an invalid regex throws.
export function searchPattern({ find, regex = false, caseSensitive = false }) {
  if (!find) return null;
  const source = regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(source, caseSensitive ? 'g' : 'gi');
}

// `text` with every match replaced, plus the [start, end] of each match before and of each replacement after.
export function replaceIn(text, pattern, replacement, { regex = false } = {}) {
  // A sticky copy replaces just the match at one place, so $1, $& and lookarounds expand exactly as Firefox would.
  const single = regex && new RegExp(pattern.source, `${pattern.flags.replace('g', '')}y`);
  const before = [];
  const after = [];
  let out = '';
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const end = match.index + match[0].length;
    let added = replacement;
    if (single) {
      single.lastIndex = match.index;
      const whole = text.replace(single, replacement);
      added = whole.slice(match.index, whole.length - (text.length - end));
    }
    out += text.slice(at, match.index);
    before.push([match.index, end]);
    after.push([out.length, out.length + added.length]);
    out += added;
    at = end;
  }
  return { text: out + text.slice(at), before, after };
}

// Every bookmark the search would change, with its new values, the ranges to highlight and why it cannot be changed, if so.
export function findReplacements(bookmarks, search) {
  const pattern = searchPattern(search);
  if (!pattern) return [];
  const out = [];
  for (const bookmark of bookmarks) {
    const changes = {};
    const before = {};
    const after = {};
    for (const field of FIELDS[search.field ?? 'both']) {
      const result = replaceIn(bookmark[field] ?? '', pattern, search.replace ?? '', search);
      if (result.text === (bookmark[field] ?? '')) continue;
      changes[field] = result.text;
      before[field] = result.before;
      after[field] = result.after;
    }
    if (!Object.keys(changes).length) continue;
    const problem = 'url' in changes && !URL.canParse(changes.url) ? 'The new URL is not a valid address' : null;
    out.push({ ...bookmark, changes, before, after, problem });
  }
  return out;
}
