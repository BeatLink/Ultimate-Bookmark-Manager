// Every change to bookmarks goes through here, so each one is snapshotted first and can be undone.

import { nodeType, sortedByName } from './tree.js';
import { loadSettings, saveSettings } from './settings.js';
import { moveRulePaths } from './organize.js';

const OTHER_BOOKMARKS = 'unfiled_____';
const DAY = 24 * 60 * 60 * 1000;

// The history without entries (to undo or redo) older than `days` or past the newest `limit`, and without id links
// no remaining entry uses.
export function pruneHistory(history, { days, limit, now = Date.now() }) {
  const keep = (list) => (list ?? []).filter((e) => !(e.time < now - days * DAY)).slice(0, limit);
  const entries = keep(history.entries);
  const redo = keep(history.redo);
  // Any text in the remaining entries may be an id that undo looks up, so every link it leads to is kept.
  const used = new Set();
  JSON.stringify([entries, redo], (key, value) => (typeof value === 'string' && used.add(value), value));
  const idMap = {};
  for (let id of used) {
    while (Object.hasOwn(history.idMap, id) && !Object.hasOwn(idMap, id)) {
      idMap[id] = history.idMap[id];
      id = history.idMap[id];
    }
  }
  return { entries, idMap, redo };
}

export function snapshot(node) {
  const snap = { id: node.id, type: nodeType(node), title: node.title ?? '' };
  if (node.url) snap.url = node.url;
  if (node.children) snap.children = node.children.map(snapshot);
  return snap;
}

export class Actions {
  constructor({ bookmarks = globalThis.browser?.bookmarks, storage = globalThis.browser?.storage.local, limit = 50, days = 30 } = {}) {
    this.bookmarks = bookmarks;
    this.storage = storage;
    this.limit = limit;
    this.days = days;
  }

  // The stored history, with expired entries forgotten and the forgetting saved.
  async load() {
    const { history } = await this.storage.get('history');
    if (!history) return { entries: [], idMap: {}, redo: [] };
    const pruned = pruneHistory(history, { days: this.days, limit: this.limit });
    if (pruned.entries.length !== history.entries.length || pruned.redo.length !== (history.redo?.length ?? 0)
      || Object.keys(pruned.idMap).length !== Object.keys(history.idMap).length) {
      await this.storage.set({ history: pruned });
    }
    return pruned;
  }

  async list() {
    return (await this.load()).entries;
  }

  // Runs a group of changes as one undoable entry; changes made before a failure are still recorded.
  async run(label, body) {
    const ops = [];
    const rec = {
      remove: (ids) => this.#remove(ids, ops),
      update: (id, changes) => this.#update(id, changes, ops),
      move: (id, dest) => this.#move(id, dest, ops),
      createFolder: (parentId, title) => this.#createFolder(parentId, title, ops),
      create: (parentId, index, snap) => this.#create(parentId, index, snap, ops),
      moveRulePaths: (from, to) => this.#moveRulePaths(from, to, ops),
    };
    try {
      return await body(rec);
    } finally {
      if (ops.length) await this.#push(label, ops);
    }
  }

  remove(ids, label = `Removed ${ids.length} item(s)`) {
    return this.run(label, (rec) => rec.remove(ids));
  }

  update(changes, label = `Edited ${changes.length} bookmark(s)`) {
    return this.run(label, async (rec) => {
      for (const { id, ...c } of changes) await rec.update(id, c);
    });
  }

  createFolder(parentId, title, label = `Created folder “${title}”`) {
    return this.run(label, (rec) => rec.createFolder(parentId, title));
  }

  // Moves a folder into another one and points the organize rules that named it, or anything inside it, at its new place.
  moveFolder(id, parentId, { from, to }, label = `Moved folder “${from.at(-1)}” into “${to.at(-2)}”`) {
    return this.run(label, async (rec) => {
      await rec.move(id, { parentId });
      await rec.moveRulePaths(from, to);
    });
  }

  // Creates bookmarks, folders (with everything inside) or separators from snapshots, starting at `index` (null for the end).
  create(parentId, index, snaps, label = `Added ${snaps.length} item(s)`) {
    return this.run(label, async (rec) => {
      const ids = [];
      for (const [i, snap] of snaps.entries()) ids.push(await rec.create(parentId, index === null ? null : index + i, snap));
      return ids;
    });
  }

  // Moves items in order to `index` of a folder, counted before any of them leave it (null for the end).
  // Each item may carry the folder path it moves `from` and `to`, so organize rules naming it follow.
  moveItems(items, parentId, index, label = `Moved ${items.length} item(s)`) {
    return this.run(label, async (rec) => {
      let at = index;
      for (const { id, from, to } of items) {
        const [node] = await this.bookmarks.get(id);
        let target = at;
        if (target !== null && node.parentId === parentId && node.index < target) target--;
        await rec.move(id, target === null ? { parentId } : { parentId, index: target });
        if (at !== null) at = target + 1;
        if (from && to && from.join('/') !== to.join('/')) await rec.moveRulePaths(from, to);
      }
    });
  }

  // Edits a bookmark or folder; a renamed folder takes the organize rules that name it along.
  edit(id, changes, paths, label = `Edited “${changes.title ?? changes.url}”`) {
    return this.run(label, async (rec) => {
      await rec.update(id, changes);
      if (paths && paths.from.join('/') !== paths.to.join('/')) await rec.moveRulePaths(paths.from, paths.to);
    });
  }

  // Sorts a folder's contents by name the way Firefox does: separators stay put and folders come first between them.
  sortFolder(folderId, label = 'Sorted a folder by name') {
    return this.run(label, async (rec) => {
      const children = await this.bookmarks.getChildren(folderId);
      const order = children.map((c) => c.id);
      for (const [i, child] of sortedByName(children).entries()) {
        const from = order.indexOf(child.id);
        if (from === i) continue;
        await rec.move(child.id, { parentId: folderId, index: i });
        order.splice(from, 1);
        order.splice(i, 0, child.id);
      }
    });
  }

  // Moves bookmarks into a folder in Other Bookmarks, creating it if needed.
  moveToFolder(ids, folderTitle, label = `Moved ${ids.length} bookmark(s) to “${folderTitle}”`) {
    return this.run(label, async (rec) => {
      const siblings = await this.bookmarks.getChildren(OTHER_BOOKMARKS);
      const existing = siblings.find((n) => nodeType(n) === 'folder' && n.title === folderTitle);
      const folderId = existing ? existing.id : await rec.createFolder(OTHER_BOOKMARKS, folderTitle);
      for (const id of ids) await rec.move(id, { parentId: folderId });
    });
  }

  // Moves each bookmark to its resolved target folder, creating any folders on the way that do not exist yet.
  organize(moves, label = `Organized ${moves.length} bookmark(s) by rule`) {
    return this.run(label, async (rec) => {
      const folders = new Map();
      const ensure = async ({ rootId, segments }) => {
        let parentId = rootId;
        for (const [i, name] of segments.entries()) {
          const key = `${rootId}/${segments.slice(0, i + 1).join('/')}`;
          if (!folders.has(key)) {
            const found = (await this.bookmarks.getChildren(parentId)).find((n) => nodeType(n) === 'folder' && n.title === name);
            folders.set(key, found ? found.id : await rec.createFolder(parentId, name));
          }
          parentId = folders.get(key);
        }
        return parentId;
      };
      for (const { id, target } of moves) await rec.move(id, { parentId: await ensure(target) });
    });
  }

  // Moves everything from the later folders of each group into the first, then removes the emptied folders.
  mergeFolders(groups, label = `Merged ${groups.length} set(s) of same-name folders`) {
    return this.run(label, async (rec) => {
      for (const group of groups) {
        const [target, ...others] = group.folders;
        for (const other of others) {
          for (const child of await this.bookmarks.getChildren(other.id)) {
            await rec.move(child.id, { parentId: target.id });
          }
          await rec.remove([other.id]);
        }
      }
    });
  }

  // Reverts the most recent entry; older entries must be undone in order. The reverted entry can then be redone.
  async undoLatest() {
    const history = await this.load();
    const entry = history.entries.shift();
    if (!entry) return null;
    const ops = [];
    try {
      await this.#revert(entry, history, ops);
    } finally {
      history.redo = [{ ...entry, ops }, ...(history.redo ?? [])];
      await this.storage.set({ history: pruneHistory(history, { days: this.days, limit: this.limit }) });
    }
    return entry;
  }

  // Applies the most recently undone entry again, which puts it back on the undo list.
  async redoLatest() {
    const history = await this.load();
    const entry = history.redo?.shift();
    if (!entry) return null;
    const ops = [];
    try {
      await this.#revert(entry, history, ops);
    } finally {
      history.entries.unshift({ ...entry, ops });
      await this.storage.set({ history: pruneHistory(history, { days: this.days, limit: this.limit }) });
    }
    return entry;
  }

  // The label of the change Redo would apply, or null.
  async nextRedo() {
    return (await this.load()).redo?.[0]?.label ?? null;
  }

  // Replaces the contents of Firefox's top-level folders with those in a backup, as one step that can be undone.
  // `folders` maps a top-level folder id to the snapshots it should hold; folders not named are left alone.
  restore(folders, label = 'Restored bookmarks from a backup') {
    return this.run(label, async (rec) => {
      for (const [rootId, snaps] of Object.entries(folders)) {
        const current = await this.bookmarks.getChildren(rootId);
        await rec.remove(current.map((c) => c.id));
        for (const snap of snaps) await rec.create(rootId, null, snap);
      }
    });
  }

  async clearHistory() {
    await this.storage.set({ history: { entries: [], idMap: {}, redo: [] } });
  }

  async #push(label, ops) {
    const history = await this.load();
    history.entries.unshift({ id: crypto.randomUUID(), time: Date.now(), label, ops });
    // A new change makes the undone ones impossible to redo in order.
    history.redo = [];
    await this.storage.set({ history: pruneHistory(history, { days: this.days, limit: this.limit }) });
  }

  // Undoes an entry's ops, newest first, recording in `ops` what it did so that it can be reverted in turn.
  // Ids of items removed and recreated since are followed through `history.idMap`.
  async #revert(entry, history, ops) {
    const resolve = (id) => {
      const seen = new Set();
      while (history.idMap[id] && !seen.has(id)) {
        seen.add(id);
        id = history.idMap[id];
      }
      return id;
    };
    const recreate = async (snap, parentId, index) => {
      const created = await this.bookmarks.create({
        parentId, ...(index === undefined || index === null ? {} : { index }), title: snap.title, type: snap.type, ...(snap.url ? { url: snap.url } : {}),
      });
      history.idMap[snap.id] = created.id;
      for (const [i, child] of (snap.children ?? []).entries()) await recreate(child, created.id, i);
      return created.id;
    };
    for (const op of [...entry.ops].reverse()) {
      if (op.kind === 'remove') ops.push({ kind: 'create', id: await recreate(op.snapshot, resolve(op.parentId), op.index) });
      else if (op.kind === 'update') await this.#update(resolve(op.id), op.before, ops);
      else if (op.kind === 'move') await this.#move(resolve(op.id), { parentId: resolve(op.from.parentId), index: op.from.index }, ops);
      else if (op.kind === 'create') await this.#remove([resolve(op.id)], ops);
      else if (op.kind === 'rulePaths') await this.#moveRulePaths(op.to, op.from, ops);
    }
  }

  async #remove(ids, ops) {
    for (const id of ids) {
      let node;
      try {
        [node] = await this.bookmarks.getSubTree(id);
      } catch {
        continue; // Already gone, e.g. removed together with an ancestor earlier in this batch.
      }
      ops.push({ kind: 'remove', parentId: node.parentId, index: node.index, snapshot: snapshot(node) });
      if (nodeType(node) === 'folder') await this.bookmarks.removeTree(id);
      else await this.bookmarks.remove(id);
    }
  }

  async #update(id, changes, ops) {
    const [node] = await this.bookmarks.get(id);
    const before = {};
    for (const key of Object.keys(changes)) before[key] = node[key] ?? '';
    await this.bookmarks.update(id, changes);
    ops.push({ kind: 'update', id, before });
  }

  async #move(id, dest, ops) {
    const [node] = await this.bookmarks.get(id);
    await this.bookmarks.move(id, dest);
    ops.push({ kind: 'move', id, from: { parentId: node.parentId, index: node.index } });
  }

  // Rewrites the saved organize rules; true when any rule changed.
  async #rewriteRules(from, to) {
    const settings = await loadSettings(this.storage);
    const [root] = await this.bookmarks.getTree();
    const roots = root.children.map((c) => ({ id: c.id, title: c.title }));
    const rules = moveRulePaths(settings.organize.rules, from, to, roots);
    if (rules === settings.organize.rules) return false;
    await saveSettings({ ...settings, organize: { ...settings.organize, rules } }, this.storage);
    return true;
  }

  async #moveRulePaths(from, to, ops) {
    if (await this.#rewriteRules(from, to)) ops.push({ kind: 'rulePaths', from, to });
  }

  // Builds a snapshot's whole tree but records only its top item, which undo removes with everything inside.
  async #create(parentId, index, snap, ops) {
    const build = async (s, parent, i) => {
      const node = await this.bookmarks.create({
        parentId: parent, ...(i === null ? {} : { index: i }), title: s.title ?? '', type: s.type, ...(s.url ? { url: s.url } : {}),
      });
      for (const child of s.children ?? []) await build(child, node.id, null);
      return node.id;
    };
    const id = await build(snap, parentId, index);
    ops.push({ kind: 'create', id });
    return id;
  }

  async #createFolder(parentId, title, ops) {
    const folder = await this.bookmarks.create({ parentId, title, type: 'folder' });
    ops.push({ kind: 'create', id: folder.id });
    return folder.id;
  }
}

// Serialises the whole bookmark tree for a downloadable backup.
export async function exportTree(bookmarks = browser.bookmarks) {
  const [root] = await bookmarks.getTree();
  return { format: 'bookmark-manager-backup', version: 1, exported: new Date().toISOString(), tree: root };
}
