// Writes this add-on's JSON backup and reads it back, or the one Firefox's Library saves with Backup….

import { nodeType, countBookmarks, TOP_FOLDERS, MENU, TOOLBAR, OTHER, MOBILE } from './tree.js';

export const BACKUP_FORMAT = 'bookmark-manager-backup';

// Firefox's backup names its top-level folders by role as well as by id.
const ROLE_IDS = { bookmarksMenuFolder: MENU, toolbarFolder: TOOLBAR, unfiledBookmarksFolder: OTHER, mobileFolder: MOBILE };
const FIREFOX_TYPES = { 1: 'bookmark', 2: 'folder', 3: 'separator' };

// The whole bookmark tree as a downloadable backup.
export async function exportTree(bookmarks = browser.bookmarks) {
  const [root] = await bookmarks.getTree();
  return { format: BACKUP_FORMAT, version: 1, exported: new Date().toISOString(), tree: root };
}

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
  const root = data?.format === BACKUP_FORMAT ? data.tree : data;
  if (!root || !Array.isArray(root.children)) throw new Error('This file is not a bookmarks backup.');
  const skipped = { count: 0 };
  const folders = {};
  for (const top of root.children) {
    const id = ROLE_IDS[top.root] ?? top.guid ?? top.id;
    if (TOP_FOLDERS.includes(id)) folders[id] = (top.children ?? []).map((c) => toSnap(c, skipped)).filter(Boolean);
  }
  if (!Object.keys(folders).length) throw new Error('This file has none of Firefox’s bookmark folders in it.');
  return { folders, bookmarks: Object.values(folders).reduce((n, snaps) => n + countBookmarks(snaps), 0), skipped: skipped.count };
}
