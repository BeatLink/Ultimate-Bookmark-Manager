import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT_IDS, nodeType, flatten, bookmarksOnly, formatPath, findNode, sortedByName, pathTo } from '../src/lib/tree.js';

const root = {
  id: 'root________',
  children: [
    { id: 'menu________', title: 'Menu', children: [
      { id: 'a', title: 'A', url: 'https://a.test/', dateAdded: 5 },
      { id: 's', type: 'separator' },
      { id: 'f', children: [{ id: 'b', title: 'B', url: 'https://b.test/' }] },
    ] },
  ],
};

test('a node type comes from its type, else its URL, else whether it has children', () => {
  assert.equal(nodeType({ type: 'folder', url: 'x' }), 'folder');
  assert.equal(nodeType({ url: 'https://a.test/' }), 'bookmark');
  assert.equal(nodeType({ children: [] }), 'folder');
  assert.equal(nodeType({}), 'separator');
});

test('the built-in folders are the ones Firefox protects', () => {
  assert.ok(ROOT_IDS.has('toolbar_____'));
  assert.ok(!ROOT_IDS.has('a'));
});

test('flattening lists every node with its folder path, using blanks for missing titles and dates', () => {
  const flat = flatten(root);
  assert.deepEqual(flat.map((n) => [n.id, n.type, n.path.join('/')]), [
    ['menu________', 'folder', ''],
    ['a', 'bookmark', 'Menu'],
    ['s', 'separator', 'Menu'],
    ['f', 'folder', 'Menu'],
    ['b', 'bookmark', 'Menu/'],
  ]);
  assert.equal(flat[1].dateAdded, 5);
  assert.equal(flat[2].title, '');
  assert.equal(flat[2].dateAdded, 0);
});

test('only bookmarks are kept from a flat list', () => {
  assert.deepEqual(bookmarksOnly(flatten(root)).map((n) => n.id), ['a', 'b']);
});

test('a folder path reads as titles joined by arrows, or (root) when empty', () => {
  assert.equal(formatPath(['Menu', 'Dev']), 'Menu › Dev');
  assert.equal(formatPath([]), '(root)');
});

test('a node is found by id anywhere in the tree, or null when absent', () => {
  assert.equal(findNode(root, 'root________'), root);
  assert.equal(findNode(root, 'b').title, 'B');
  assert.equal(findNode(root, 'nope'), null);
});

test('sorting by name keeps separators in place and puts folders first between them', () => {
  const kids = [{ title: 'b', url: 'x' }, { title: 'Z', children: [] }, { type: 'separator' }, { url: 'y' }, { title: 'a', url: 'z' }];
  assert.deepEqual(sortedByName(kids).map((n) => n.title ?? n.type ?? ''), ['Z', 'b', 'separator', '', 'a']);
});

test('the path to a node lists titles from the top-level folder down, stopping below the root', () => {
  const byId = new Map([
    ['menu________', { id: 'menu________', parentId: 'root________', title: 'Menu' }],
    ['root________', { id: 'root________', title: '' }],
    ['f', { id: 'f', parentId: 'menu________' }],
    ['b', { id: 'b', parentId: 'f', title: 'B' }],
  ]);
  assert.deepEqual(pathTo(byId, 'b'), ['Menu', '', 'B']);
  assert.deepEqual(pathTo(byId, 'missing'), []);
});
