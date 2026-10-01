// Helpers for walking the tree returned by browser.bookmarks.getTree().

import { byText } from './text.js';

// The ids Firefox gives its built-in folders, which add-ons can neither remove nor rename.
export const ROOT = 'root________';
export const MENU = 'menu________';
export const TOOLBAR = 'toolbar_____';
export const OTHER = 'unfiled_____';
export const MOBILE = 'mobile______';
export const TOP_FOLDERS = [MENU, TOOLBAR, OTHER, MOBILE];
export const ROOT_IDS = new Set([ROOT, ...TOP_FOLDERS]);

export function nodeType(node) {
  if (node.type) return node.type;
  if (node.url) return 'bookmark';
  return node.children ? 'folder' : 'separator';
}

export const isFolder = (node) => nodeType(node) === 'folder';
export const isBookmark = (node) => nodeType(node) === 'bookmark';

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

// The top-level folders as organize rules see them: id and title.
export function rootFoldersOf(root) {
  return root.children.map((c) => ({ id: c.id, title: c.title }));
}

// Counts the bookmarks in a list of snapshots, folders included.
export function countBookmarks(snaps) {
  return snaps.reduce((n, s) => n + (s.type === 'bookmark' ? 1 : countBookmarks(s.children ?? [])), 0);
}

// A folder's children in Firefox's "Sort by name" order: separators stay where they are, and between them folders come first, then the rest by name.
export function sortedByName(children) {
  const out = [];
  let run = [];
  const flush = () => {
    const folderFirst = (n) => (isFolder(n) ? 0 : 1);
    run.sort((a, b) => folderFirst(a) - folderFirst(b) || byText(a.title ?? '', b.title ?? ''));
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
