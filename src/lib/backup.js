// Reads a JSON bookmarks backup, either this add-on's own or the one Firefox's Library saves with Backup….

import { nodeType } from './tree.js';

export const TOP_FOLDERS = ['menu________', 'toolbar_____', 'unfiled_____', 'mobile______'];

// Firefox's backup names its top-level folders by role as well as by id.
const ROLE_IDS = { bookmarksMenuFolder: 'menu________', toolbarFolder: 'toolbar_____', unfiledBookmarksFolder: 'unfiled_____', mobileFolder: 'mobile______' };
const FIREFOX_TYPES = { 1: 'bookmark', 2: 'folder', 3: 'separator' };

// Firefox's saved searches ("place:" links) cannot be created by add-ons, so they are left out and counted.
function toSnap(node, skipped) {
  const type = node.typeCode ? FIREFOX_TYPES[node.typeCode] : nodeType(node);
  const url = node.uri ?? node.url;
  if (!type || (type === 'bookmark' && (!url || url.startsWith('place:')))) {
    skipped.count++;
    return null;
  }
  const snap = { type, title: node.title ?? '' };
  if (type === 'bookmark') snap.url = url;
  if (type === 'folder') snap.children = (node.children ?? []).map((c) => toSnap(c, skipped)).filter(Boolean);
  return snap;
}

// Returns { folders: { topFolderId: snapshots }, bookmarks, skipped }, or throws with a readable reason.
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a JSON file.');
  }
  const root = data?.format === 'bookmark-manager-backup' ? data.tree : data;
  if (!root || !Array.isArray(root.children)) throw new Error('This file is not a bookmarks backup.');
  const skipped = { count: 0 };
  const folders = {};
  for (const top of root.children) {
    const id = ROLE_IDS[top.root] ?? top.guid ?? top.id;
    if (TOP_FOLDERS.includes(id)) folders[id] = (top.children ?? []).map((c) => toSnap(c, skipped)).filter(Boolean);
  }
  if (!Object.keys(folders).length) throw new Error('This file has none of Firefox’s bookmark folders in it.');
  const count = (snaps) => snaps.reduce((n, s) => n + (s.type === 'bookmark' ? 1 : count(s.children ?? [])), 0);
  return { folders, bookmarks: Object.values(folders).reduce((n, snaps) => n + count(snaps), 0), skipped: skipped.count };
}
