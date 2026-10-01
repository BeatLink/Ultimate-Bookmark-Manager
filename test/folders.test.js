import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findEmptyFolders, findSameNameFolders, findUntitled, ignoredIdSet } from '../src/lib/folders.js';
import { flatten } from '../src/lib/tree.js';

const tree = {
  id: 'root________',
  children: [
    {
      id: 'menu________', title: 'Menu', children: [
        { id: 'e1', title: 'Empty', index: 0, children: [{ id: 'e2', title: 'Inner', index: 0, children: [] }, { id: 's', type: 'separator', index: 1 }] },
        { id: 'f1', title: 'News', index: 1, children: [{ id: 'b1', url: 'https://a.test', title: '', index: 0 }] },
        { id: 'f2', title: 'News ', index: 2, children: [{ id: 'b2', url: 'https://b.test', title: 'B', index: 0 }] },
      ],
    },
    { id: 'mobile______', title: 'Mobile', children: [] },
  ],
};

test('only the topmost empty folder is reported and built-in roots are never', () => {
  const found = findEmptyFolders(tree);
  assert.deepEqual(found.map((f) => [f.id, f.subfolders]), [['e1', 1]]);
});

test('sibling folders with the same trimmed name are grouped by position', () => {
  const groups = findSameNameFolders(tree);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].folders.map((f) => f.id), ['f1', 'f2']);
});

test('bookmarks with blank titles are found', () => {
  assert.deepEqual(findUntitled(flatten(tree)).map((b) => b.id), ['b1']);
});

test('a folder ignored with its contents hides everything inside it, while a plain ignored folder hides only itself', () => {
  const ignored = ignoredIdSet(tree, { e1: { title: 'Empty', inside: true }, f1: { title: 'News' } });
  assert.deepEqual([...ignored].sort(), ['e1', 'e2', 'f1', 's']);
  assert.deepEqual(findEmptyFolders(tree, ignored), []);
  assert.deepEqual(findUntitled(flatten(tree), ignoredIdSet(tree, { f1: { title: 'News', inside: true } })), []);
});
