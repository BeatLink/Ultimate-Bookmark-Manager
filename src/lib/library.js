// The All bookmarks list: which items a search shows and where the focus goes once rows are removed.

import { formatPath } from './tree.js';

// Whether a flat record matches the search box and filter; `dupeIds` holds every duplicate while a duplicate filter is on.
export function matchesSearch(item, { query, filter, dupeIds }) {
  if (item.type === 'separator' || (filter === 'recent' && item.type !== 'bookmark')) return false;
  if (dupeIds) {
    if (item.type !== 'bookmark') return false;
    if (filter === 'dupes' ? !dupeIds.has(item.id) : dupeIds.has(item.id)) return false;
  }
  return !query || item.title.toLowerCase().includes(query) || (item.url ?? '').toLowerCase().includes(query) || formatPath(item.path).toLowerCase().includes(query);
}

// The id to focus once the chosen ids are gone: the first after them that is not inside one, else the last before them.
export function nextAfterRemoval(ids, chosen, inside) {
  let first = -1;
  let last = -1;
  ids.forEach((id, i) => {
    if (!chosen.has(id)) return;
    if (first < 0) first = i;
    last = i;
  });
  const after = ids.slice(last + 1).find((id) => !inside(id, chosen));
  const before = ids.slice(0, first).reverse().find((id) => !inside(id, chosen));
  return after ?? before ?? null;
}
