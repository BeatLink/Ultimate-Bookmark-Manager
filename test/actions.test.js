import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Actions, pruneHistory } from '../src/lib/actions.js';
import { parseBackup } from '../src/lib/backup.js';
import { fakeBookmarks, fakeStorage } from './fake-browser.js';
import { setup, shape, titles } from './helpers.js';

test('remove then undo restores the tree, including folder contents and position', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  await actions.remove(['a', 'f']);
  assert.notDeepEqual(await shape(bookmarks), before);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('merge then undo restores both folders', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  await actions.mergeFolders([{ folders: [{ id: 'f' }, { id: 'g' }] }]);
  assert.deepEqual(await titles(bookmarks, 'f'), ['E', 'H']);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('move to folder creates it once and undo removes it again', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  await actions.moveToFolder(['a', 'e'], 'Dupes');
  assert.deepEqual(await titles(bookmarks, 'unfiled_____'), ['Dupes']);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('undo of an older entry follows ids remapped by a newer undo', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  await actions.update([{ id: 'e', title: 'Renamed' }]);
  await actions.remove(['f']);
  await actions.undoLatest();
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('organize creates missing nested folders, reuses existing ones, and undo removes what it created', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  const target = { rootId: 'unfiled_____', segments: ['Dev', 'Web'] };
  await actions.organize([{ id: 'a', target }, { id: 'b', target }, { id: 'c', target: { rootId: 'menu________', segments: ['Folder'] } }]);
  const [dev] = await bookmarks.getChildren('unfiled_____');
  const [web] = await bookmarks.getChildren(dev.id);
  assert.deepEqual(await titles(bookmarks, web.id), ['A', 'B']);
  assert.deepEqual(await titles(bookmarks, 'f'), ['E', 'C']);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('a created folder is one undoable step', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  await actions.createFolder('f', 'Sub');
  assert.deepEqual(await titles(bookmarks, 'f'), ['E', 'Sub']);
  assert.equal((await actions.list())[0].label, 'Created folder “Sub”');
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('moving a folder rewrites the rules that name it, and undo puts both back', async () => {
  const { bookmarks, storage, actions } = setup();
  const rules = [{ id: 'r', name: 'r', enabled: true, target: 'Menu/Folder/Sub', query: { combinator: 'and', rules: [{ id: 'c', field: 'folder', operator: 'inFolder', value: 'Menu/Folder' }] } }];
  await storage.set({ settings: { organize: { rules, autoApply: false } } });
  const before = await shape(bookmarks);
  await actions.moveFolder('f', 'unfiled_____', { from: ['Menu', 'Folder'], to: ['Other', 'Folder'] });
  assert.deepEqual(await titles(bookmarks, 'unfiled_____'), ['Folder']);
  const saved = (await storage.get('settings')).settings.organize.rules[0];
  assert.equal(saved.target, 'Other/Folder/Sub');
  assert.equal(saved.query.rules[0].value, 'Other/Folder');
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
  const restored = (await storage.get('settings')).settings.organize.rules[0];
  assert.equal(restored.target, 'Menu/Folder/Sub');
  assert.equal(restored.query.rules[0].value, 'Menu/Folder');
});

test('moving items down in their own folder lands them before the drop target', async () => {
  const { bookmarks, actions } = setup();
  await actions.moveItems([{ id: 'a' }, { id: 'b' }], 'menu________', 3);
  assert.deepEqual(await titles(bookmarks, 'menu________'), ['C', 'A', 'B', 'D', 'Folder', 'Folder']);
});

test('moving items up in their own folder keeps their order', async () => {
  const { bookmarks, actions } = setup();
  await actions.moveItems([{ id: 'c' }, { id: 'd' }], 'menu________', 0);
  assert.deepEqual(await titles(bookmarks, 'menu________'), ['C', 'D', 'A', 'B', 'Folder', 'Folder']);
});

test('moving into another folder then undoing restores every position', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  await actions.moveItems([{ id: 'd' }, { id: 'a' }], 'f', 0);
  assert.deepEqual(await titles(bookmarks, 'f'), ['D', 'A', 'E']);
  await actions.moveItems([{ id: 'b' }], 'f', null);
  assert.deepEqual(await titles(bookmarks, 'f'), ['D', 'A', 'E', 'B']);
  await actions.undoLatest();
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('creating copies of a folder builds its contents and undo removes it in one step', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  const [copy] = await actions.create('unfiled_____', null, [
    { type: 'folder', title: 'Copy', children: [{ type: 'bookmark', title: 'X', url: 'https://x.test' }, { type: 'separator', title: '' }] },
  ]);
  assert.deepEqual(await titles(bookmarks, copy), ['X', '']);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('sorting a folder puts folders first, keeps separators in place, and undoes', async () => {
  const { bookmarks, actions } = setup([{ id: 'menu________', title: 'Menu', children: [
    { title: 'b', url: 'https://b.test' }, { title: 'Z', children: [] }, { title: 'a', url: 'https://a.test' },
    { type: 'separator' },
    { title: 'item10', url: 'https://10.test' }, { title: 'item2', url: 'https://2.test' },
  ] }]);
  const before = await shape(bookmarks);
  await actions.sortFolder('menu________');
  assert.deepEqual(await titles(bookmarks, 'menu________'), ['Z', 'a', 'b', '', 'item2', 'item10']);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('undo then redo applies a change again, and redo again after a second undo', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  await actions.moveItems([{ id: 'a' }], 'f', null);
  await actions.remove(['f']);
  const after = await shape(bookmarks);
  await actions.undoLatest();
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
  assert.equal(await actions.nextRedo(), 'Moved 1 item(s)');
  await actions.redoLatest();
  await actions.redoLatest();
  assert.deepEqual(await shape(bookmarks), after);
  assert.equal(await actions.nextRedo(), null);
  await actions.undoLatest();
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
  await actions.redoLatest();
  await actions.redoLatest();
  assert.deepEqual(await shape(bookmarks), after);
});

test('a new change clears what could be redone', async () => {
  const { actions } = setup();
  await actions.update([{ id: 'a', title: 'X' }]);
  await actions.undoLatest();
  assert.ok(await actions.nextRedo());
  await actions.update([{ id: 'b', title: 'Y' }]);
  assert.equal(await actions.nextRedo(), null);
  assert.equal(await actions.redoLatest(), null);
});

test('restoring a backup replaces the top-level folders and undoes in one step', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  const { folders } = parseBackup(JSON.stringify({
    guid: 'root________', children: [
      { guid: 'menu________', root: 'bookmarksMenuFolder', children: [
        { typeCode: 1, title: 'New', uri: 'https://new.test' },
        { typeCode: 2, title: 'Dir', children: [{ typeCode: 3 }] },
      ] },
    ],
  }));
  await actions.restore(folders);
  assert.deepEqual(await titles(bookmarks, 'menu________'), ['New', 'Dir']);
  assert.deepEqual(await titles(bookmarks, 'unfiled_____'), []);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('history older than its age limit is forgotten, with the id links only it used', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 100 * day;
  const history = {
    entries: [
      { id: 'new', time: now - day, label: 'new', ops: [{ kind: 'move', id: 'a', from: { parentId: 'p', index: 0 } }] },
      { id: 'old', time: now - 40 * day, label: 'old', ops: [{ kind: 'move', id: 'z', from: { parentId: 'q', index: 0 } }] },
    ],
    idMap: { a: 'a2', a2: 'a3', z: 'z2', p: 'p2' },
  };
  const pruned = pruneHistory(history, { days: 30, limit: 50, now });
  assert.deepEqual(pruned.entries.map((e) => e.id), ['new']);
  assert.deepEqual(pruned.idMap, { a: 'a2', a2: 'a3', p: 'p2' }, 'chains are followed and unused links dropped');
  assert.deepEqual(pruneHistory(history, { days: 30, limit: 0, now }), { entries: [], idMap: {}, redo: [] });
  const withRedo = pruneHistory({ ...history, entries: [], redo: history.entries }, { days: 30, limit: 50, now });
  assert.deepEqual(withRedo.redo.map((e) => e.id), ['new'], 'changes waiting to be redone expire the same way');
  assert.deepEqual(withRedo.idMap, { a: 'a2', a2: 'a3', p: 'p2' }, 'and keep the links they use');
});

test('loading the history saves it once old entries have been forgotten', async () => {
  const storage = fakeStorage();
  await storage.set({ history: { entries: [{ id: 'x', time: 0, label: 'ancient', ops: [] }], idMap: { k: 'v' } } });
  const entries = await new Actions({ bookmarks: fakeBookmarks([]), storage, days: 30 }).list();
  assert.deepEqual(entries, []);
  assert.deepEqual(storage.data.history, { entries: [], idMap: {}, redo: [] });
});
