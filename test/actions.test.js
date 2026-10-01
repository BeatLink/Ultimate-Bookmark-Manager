import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Actions } from '../src/lib/actions.js';
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
  assert.deepEqual(pruneHistory(history, { days: 30, limit: 0, now }), { entries: [], idMap: {} });
});

test('loading the history saves it once old entries have been forgotten', async () => {
  const { Actions } = await import('../src/lib/actions.js');
  const stored = { history: { entries: [{ id: 'x', time: 0, label: 'ancient', ops: [] }], idMap: { k: 'v' } } };
  const storage = { async get(key) { return { [key]: stored[key] }; }, async set(v) { Object.assign(stored, v); } };
  const entries = await new Actions({ storage, days: 30 }).list();
  assert.deepEqual(entries, []);
  assert.deepEqual(stored.history, { entries: [], idMap: {} });
});
