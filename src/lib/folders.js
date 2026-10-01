// Folder-level checks: empty folders, same-name siblings and bookmarks without a useful name.

import { ROOT_IDS, isFolder, isBookmark } from './tree.js';
import { groupBy } from './group.js';

function containsBookmark(node) {
  return (node.children ?? []).some((c) => isBookmark(c) || (isFolder(c) && containsBookmark(c)));
}

function countFolders(node) {
  return (node.children ?? []).reduce((n, c) => (isFolder(c) ? n + 1 + countFolders(c) : n), 0);
}

// The ids every check skips: each ignored item, plus everything inside a folder ignored with its contents.
export function ignoredIdSet(root, whitelist) {
  const out = new Set(Object.keys(whitelist));
  const addAll = (node) => {
    out.add(node.id);
    for (const child of node.children ?? []) addAll(child);
  };
  const walk = (node) => {
    if (whitelist[node.id]?.inside) return addAll(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return out;
}

// Returns the topmost folders holding no bookmarks anywhere inside; removing one removes its empty subfolders too.
export function findEmptyFolders(root, ignoredIds = new Set()) {
  const out = [];
  const walk = (folder, path) => {
    for (const child of folder.children ?? []) {
      if (!isFolder(child)) continue;
      if (!ROOT_IDS.has(child.id) && !ignoredIds.has(child.id) && !containsBookmark(child)) {
        out.push({ id: child.id, parentId: child.parentId, title: child.title ?? '', path, subfolders: countFolders(child) });
      } else {
        walk(child, [...path, child.title ?? '']);
      }
    }
  };
  walk(root, []);
  return out;
}

// Returns groups of sibling folders sharing a name, each ordered by position with the first as merge target.
export function findSameNameFolders(root, ignoredIds = new Set()) {
  const out = [];
  const walk = (folder, path) => {
    const subfolders = (folder.children ?? []).filter(isFolder);
    for (const child of subfolders) walk(child, [...path, child.title ?? '']);
    const candidates = subfolders.filter((c) => !ROOT_IDS.has(c.id) && !ignoredIds.has(c.id));
    for (const [name, siblings] of groupBy(candidates, (c) => (c.title ?? '').trim())) {
      if (siblings.length < 2) continue;
      const folders = siblings.map((c) => ({ id: c.id, index: c.index, title: c.title ?? '', size: (c.children ?? []).length })).sort((a, b) => a.index - b.index);
      out.push({ parentId: folder.id, path, title: name, folders });
    }
  };
  walk(root, []);
  return out;
}

// A URL reduced to what a reader would compare: no scheme, no "www.", no trailing slash, any case.
function looseUrl(text) {
  let t = text.trim().toLowerCase();
  try {
    t = decodeURI(t);
  } catch {
    // Leave text with stray % signs as it is.
  }
  return t.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

// Says why a bookmark's name does not help: "blank", or "url" when the name is just a URL.
export function unhelpfulName(title, url) {
  const t = (title ?? '').trim();
  if (!t) return 'blank';
  if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(t)) return 'url';
  if (url && looseUrl(t) === looseUrl(url)) return 'url';
  return null;
}

// Bookmarks without a useful name, each tagged with the reason.
export function findUntitled(flat, ignoredIds = new Set()) {
  return flat
    .filter((n) => n.type === 'bookmark' && !ignoredIds.has(n.id))
    .map((n) => ({ ...n, reason: unhelpfulName(n.title, n.url) }))
    .filter((n) => n.reason);
}
