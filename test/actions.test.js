import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Actions, exportTree } from '../src/lib/actions.js';
import { fakeBookmarks, fakeStorage } from './fake-browser.js';

const spec = () => [
  { id: 'menu________', title: 'Menu', children: [
    { id: 'a', title: 'A', url: 'https://a.test' },
    { id: 'f', title: 'Folder', children: [{ id: 'b', title: 'B', url: 'https://b.test' }] },
    { id: 'g', title: 'Folder', children: [{ id: 'c', title: 'C', url: 'https://c.test' }] },
  ] },
  { id: 'unfiled_____', title: 'Other', children: [] },
];

const shape = async (bm) => {
  const strip = (n) => ({ title: n.title, url: n.url, children: n.children?.map(strip) });
  return strip((await bm.getTree())[0]);
};

test('remove then undo restores the tree, including folder contents and position', async () => {
  const bookmarks = fakeBookmarks(spec());
  const actions = new Actions({ bookmarks, storage: fakeStorage() });
  const before = await shape(bookmarks);
  await actions.remove(['a', 'f']);
  assert.notDeepEqual(await shape(bookmarks), before);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('merge then undo restores both folders', async () => {
  const bookmarks = fakeBookmarks(spec());
  const actions = new Actions({ bookmarks, storage: fakeStorage() });
  const before = await shape(bookmarks);
  await actions.mergeFolders([{ folders: [{ id: 'f' }, { id: 'g' }] }]);
  assert.deepEqual((await bookmarks.getChildren('f')).map((n) => n.title), ['B', 'C']);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('move to folder creates it once and undo removes it again', async () => {
  const bookmarks = fakeBookmarks(spec());
  const actions = new Actions({ bookmarks, storage: fakeStorage() });
  const before = await shape(bookmarks);
  await actions.moveToFolder(['a', 'b'], 'Dupes');
  const other = await bookmarks.getChildren('unfiled_____');
  assert.deepEqual(other.map((n) => n.title), ['Dupes']);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('undo of an older entry follows ids remapped by a newer undo', async () => {
  const bookmarks = fakeBookmarks(spec());
  const actions = new Actions({ bookmarks, storage: fakeStorage() });
  const before = await shape(bookmarks);
  await actions.update([{ id: 'b', title: 'Renamed' }]);
  await actions.remove(['f']);
  await actions.undoLatest();
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('organize creates missing nested folders, reuses existing ones, and undo removes what it created', async () => {
  const bookmarks = fakeBookmarks(spec());
  const actions = new Actions({ bookmarks, storage: fakeStorage() });
  const before = await shape(bookmarks);
  const target = { rootId: 'unfiled_____', segments: ['Dev', 'Web'] };
  await actions.organize([{ id: 'a', target }, { id: 'b', target }, { id: 'c', target: { rootId: 'menu________', segments: ['Folder'] } }]);
  const [dev] = await bookmarks.getChildren('unfiled_____');
  const [web] = await bookmarks.getChildren(dev.id);
  assert.deepEqual((await bookmarks.getChildren(web.id)).map((n) => n.title), ['A', 'B']);
  assert.deepEqual((await bookmarks.getChildren('f')).map((n) => n.title), ['C']);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('a created folder is one undoable step', async () => {
  const bookmarks = fakeBookmarks(spec());
  const actions = new Actions({ bookmarks, storage: fakeStorage() });
  const before = await shape(bookmarks);
  await actions.createFolder('f', 'Sub');
  assert.deepEqual((await bookmarks.getChildren('f')).map((n) => n.title), ['B', 'Sub']);
  assert.equal((await actions.list())[0].label, 'Created folder “Sub”');
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('moving a folder rewrites the rules that name it, and undo puts both back', async () => {
  const bookmarks = fakeBookmarks(spec());
  const storage = fakeStorage();
  const rules = [{ id: 'r', name: 'r', enabled: true, target: 'Menu/Folder/Sub', query: { combinator: 'and', rules: [{ id: 'c', field: 'folder', operator: 'inFolder', value: 'Menu/Folder' }] } }];
  await storage.set({ settings: { organize: { rules, autoApply: false } } });
  const actions = new Actions({ bookmarks, storage });
  const before = await shape(bookmarks);
  await actions.moveFolder('f', 'unfiled_____', { from: ['Menu', 'Folder'], to: ['Other', 'Folder'] });
  assert.deepEqual((await bookmarks.getChildren('unfiled_____')).map((n) => n.title), ['Folder']);
  const saved = (await storage.get('settings')).settings.organize.rules[0];
  assert.equal(saved.target, 'Other/Folder/Sub');
  assert.equal(saved.query.rules[0].value, 'Other/Folder');
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
  const restored = (await storage.get('settings')).settings.organize.rules[0];
  assert.equal(restored.target, 'Menu/Folder/Sub');
  assert.equal(restored.query.rules[0].value, 'Menu/Folder');
});

test('history older than its age limit is forgotten, with the id links only it used', async () => {
  const { pruneHistory } = await import('../src/lib/actions.js');
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
  const { Actions } = await import('../src/lib/actions.js');
  const stored = { history: { entries: [{ id: 'x', time: 0, label: 'ancient', ops: [] }], idMap: { k: 'v' } } };
  const storage = { async get(key) { return { [key]: stored[key] }; }, async set(v) { Object.assign(stored, v); } };
  const entries = await new Actions({ storage, days: 30 }).list();
  assert.deepEqual(entries, []);
  assert.deepEqual(stored.history, { entries: [], idMap: {}, redo: [] });
});

test('renaming a folder points the organize rules at its new name, and undo puts both back', async () => {
  const bookmarks = fakeBookmarks(spec());
  const storage = fakeStorage();
  const query = { id: 'q', combinator: 'or', not: false, rules: [{ id: 'c', field: 'either', operator: 'contains', value: 'x' }] };
  await storage.set({ settings: { organize: { rules: [{ id: 'r', name: 'r', target: 'Menu/Folder/Sub', query }] } } });
  const actions = new Actions({ bookmarks, storage });
  await actions.edit('f', { title: 'Renamed' }, { from: ['Menu', 'Folder'], to: ['Menu', 'Renamed'] });
  assert.equal((await bookmarks.get('f'))[0].title, 'Renamed');
  assert.equal(storage.data.settings.organize.rules[0].target, 'Menu/Renamed/Sub');
  assert.equal((await actions.list())[0].label, 'Edited “Renamed”');
  await actions.undoLatest();
  assert.equal((await bookmarks.get('f'))[0].title, 'Folder');
  assert.equal(storage.data.settings.organize.rules[0].target, 'Menu/Folder/Sub');
});

test('an edit without a folder rename leaves the organize rules alone and is labelled by its URL when untitled', async () => {
  const bookmarks = fakeBookmarks(spec());
  const storage = fakeStorage();
  const actions = new Actions({ bookmarks, storage });
  await actions.edit('a', { url: 'https://new.test/' });
  await actions.edit('g', { title: 'Folder' }, { from: ['Menu', 'Folder'], to: ['Menu', 'Folder'] });
  assert.equal((await bookmarks.get('a'))[0].url, 'https://new.test/');
  assert.deepEqual((await actions.list()).map((e) => [e.label, e.ops.map((o) => o.kind)]), [['Edited “Folder”', ['update']], ['Edited “https://new.test/”', ['update']]]);
  assert.equal(storage.data.settings, undefined);
});

test('removing a folder together with something inside it removes the folder once and undo restores it', async () => {
  const bookmarks = fakeBookmarks(spec());
  const actions = new Actions({ bookmarks, storage: fakeStorage() });
  const before = await shape(bookmarks);
  await actions.remove(['f', 'b']);
  const [entry] = await actions.list();
  assert.deepEqual(entry.ops.map((o) => [o.kind, o.snapshot.id]), [['remove', 'f']]);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('clearing the history forgets every undo and redo step', async () => {
  const storage = fakeStorage();
  const actions = new Actions({ bookmarks: fakeBookmarks(spec()), storage });
  await actions.remove(['a']);
  await actions.remove(['c']);
  await actions.undoLatest();
  await actions.clearHistory();
  assert.deepEqual(storage.data.history, { entries: [], idMap: {}, redo: [] });
  assert.equal(await actions.nextRedo(), null);
});

test('a backup export holds the whole tree with its format, version and time', async () => {
  const bookmarks = fakeBookmarks(spec());
  const backup = await exportTree(bookmarks);
  assert.equal(backup.format, 'bookmark-manager-backup');
  assert.equal(backup.version, 1);
  assert.ok(!Number.isNaN(Date.parse(backup.exported)));
  assert.deepEqual(backup.tree, (await bookmarks.getTree())[0]);
});
