// Helpers for walking the tree returned by browser.bookmarks.getTree().

import { byText } from './text.js';

// Built-in folders Firefox does not let extensions remove or rename.
export const ROOT_IDS = new Set([
  'root________',
  'menu________',
  'toolbar_____',
  'unfiled_____',
  'mobile______',
]);

export function nodeType(node) {
  if (node.type) return node.type;
  if (node.url) return 'bookmark';
  return node.children ? 'folder' : 'separator';
}

// Returns every node below the root as a flat record carrying its folder path.
export function flatten(root) {
  const out = [];
  const walk = (folder, path) => {
    for (const child of folder.children ?? []) {
      const type = nodeType(child);
      out.push({
        id: child.id,
        parentId: child.parentId,
        index: child.index,
        title: child.title ?? '',
        url: child.url,
        type,
        dateAdded: child.dateAdded ?? 0,
        path,
      });
      if (type === 'folder') walk(child, [...path, child.title ?? '']);
    }
  };
  walk(root, []);
  return out;
}

export function bookmarksOnly(flat) {
  return flat.filter((n) => n.type === 'bookmark');
}

export function formatPath(path) {
  return path.length ? path.join(' › ') : '(root)';
}

// Finds a node by id anywhere below the given root.
export function findNode(root, id) {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

// A folder's children in Firefox's "Sort by name" order: separators stay where they are, and between them folders come first, then the rest by name.
export function sortedByName(children) {
  const out = [];
  let run = [];
  const flush = () => {
    const isFolder = (n) => (nodeType(n) === 'folder' ? 0 : 1);
    run.sort((a, b) => isFolder(a) - isFolder(b) || byText(a.title ?? '', b.title ?? ''));
    out.push(...run);
    run = [];
  };
  for (const child of children) {
    if (nodeType(child) === 'separator') {
      flush();
      out.push(child);
    } else run.push(child);
  }
  flush();
  return out;
}

// The folder titles from the top-level folder down to the given node, as organize rules store paths.
export function pathTo(byId, id) {
  const out = [];
  for (let node = byId.get(id); node && node.parentId; node = byId.get(node.parentId)) out.unshift(node.title ?? '');
  return out;
}
