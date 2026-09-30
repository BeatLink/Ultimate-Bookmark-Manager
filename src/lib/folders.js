// Folder-level checks: empty folders, same-name siblings and bookmarks without a name.

import { ROOT_IDS, nodeType } from './tree.js';

function containsBookmark(node) {
  return (node.children ?? []).some((c) => nodeType(c) === 'bookmark' || (nodeType(c) === 'folder' && containsBookmark(c)));
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

export function findUntitled(flat, ignoredIds = new Set()) {
  return flat.filter((n) => n.type === 'bookmark' && !ignoredIds.has(n.id) && !n.title.trim());
}
