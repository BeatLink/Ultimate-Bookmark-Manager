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
