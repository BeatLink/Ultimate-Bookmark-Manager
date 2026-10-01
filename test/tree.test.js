import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortedByName, pathTo, flatten, countBookmarks, rootFoldersOf, formatPath, nodeType } from '../src/lib/tree.js';
import { setup } from './helpers.js';

test('sortedByName leaves an already sorted folder alone', () => {
  const kids = [{ id: '1', title: 'F', children: [] }, { id: '2', title: 'a', url: 'x' }];
  assert.deepEqual(sortedByName(kids).map((k) => k.id), ['1', '2']);
});

test('node types are read from the node or guessed from its shape', () => {
  assert.equal(nodeType({ type: 'separator' }), 'separator');
  assert.equal(nodeType({ url: 'https://a.test' }), 'bookmark');
  assert.equal(nodeType({ children: [] }), 'folder');
  assert.equal(nodeType({}), 'separator');
});

test('flatten gives every node its folder path, and paths format with › or as the root', async () => {
  const { bookmarks } = setup();
  const [root] = await bookmarks.getTree();
  const flat = flatten(root);
  assert.deepEqual(flat.find((n) => n.id === 'e').path, ['Menu', 'Folder']);
  assert.equal(flat.filter((n) => n.type === 'bookmark').length, 6);
  assert.equal(formatPath(['Menu', 'Folder']), 'Menu › Folder');
  assert.equal(formatPath([]), '(root)');
});

test('pathTo lists folder titles from the top-level folder down', async () => {
  const { bookmarks } = setup();
  const [root] = await bookmarks.getTree();
  const byId = new Map();
  const walk = (n) => { byId.set(n.id, n); n.children?.forEach(walk); };
  walk(root);
  assert.deepEqual(pathTo(byId, 'e'), ['Menu', 'Folder', 'E']);
});

test('the root folders are listed by id and title', async () => {
  const { bookmarks } = setup();
  const [root] = await bookmarks.getTree();
  assert.deepEqual(rootFoldersOf(root), [{ id: 'menu________', title: 'Menu' }, { id: 'unfiled_____', title: 'Other' }]);
});

test('bookmarks are counted through nested folders', () => {
  const snaps = [{ type: 'bookmark' }, { type: 'folder', children: [{ type: 'bookmark' }, { type: 'separator' }, { type: 'folder', children: [{ type: 'bookmark' }] }] }];
  assert.equal(countBookmarks(snaps), 3);
});
