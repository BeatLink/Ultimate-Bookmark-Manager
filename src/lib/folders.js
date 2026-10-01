// Folder-level checks: empty folders, same-name siblings and bookmarks without a useful name.

import { ROOT_IDS, nodeType } from './tree.js';

function containsBookmark(node) {
  return (node.children ?? []).some((c) => nodeType(c) === 'bookmark' || (nodeType(c) === 'folder' && containsBookmark(c)));
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
      if (nodeType(child) !== 'folder') continue;
      const childPath = [...path, child.title ?? ''];
      if (!ROOT_IDS.has(child.id) && !ignoredIds.has(child.id) && !containsBookmark(child)) {
        out.push({ id: child.id, parentId: child.parentId, title: child.title ?? '', path, subfolders: countFolders(child) });
      } else {
        walk(child, childPath);
      }
    }
  };
  walk(root, []);
  return out;
}

function countFolders(node) {
  return (node.children ?? []).reduce((n, c) => (nodeType(c) === 'folder' ? n + 1 + countFolders(c) : n), 0);
}

// Returns groups of sibling folders sharing a name, each ordered by position with the first as merge target.
export function findSameNameFolders(root, ignoredIds = new Set()) {
  const out = [];
  const walk = (folder, path) => {
    const byName = new Map();
    for (const child of folder.children ?? []) {
      if (nodeType(child) !== 'folder') continue;
      walk(child, [...path, child.title ?? '']);
      if (ROOT_IDS.has(child.id) || ignoredIds.has(child.id)) continue;
      const name = (child.title ?? '').trim();
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ id: child.id, index: child.index, title: child.title ?? '', size: (child.children ?? []).length });
    }
    for (const [name, folders] of byName) {
      if (folders.length < 2) continue;
      folders.sort((a, b) => a.index - b.index);
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
