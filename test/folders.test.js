import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findEmptyFolders, findSameNameFolders, findUntitled, unhelpfulName } from '../src/lib/folders.js';
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

test('names that are blank or just a URL are flagged', () => {
  const cases = [
    ['', 'https://a.test/', 'blank'],
    ['   ', 'https://a.test/', 'blank'],
    ['https://a.test/page', 'https://a.test/page', 'url'],
    ['www.Example.com/Docs/', 'https://example.com/docs', 'url'],
    ['example.com/caf%C3%A9', 'https://example.com/café', 'url'],
    ['http://other.test/x', 'https://a.test/', 'url'],
    ['Example Docs', 'https://example.com/docs', null],
    ['example.com', 'https://example.com/docs/page', null],
  ];
  for (const [title, url, reason] of cases) assert.equal(unhelpfulName(title, url), reason, `${JSON.stringify(title)} for ${url}`);
});

test('findUntitled tags each bookmark with the reason', () => {
  const flat = [
    { id: '1', type: 'bookmark', title: '', url: 'https://a.test/' },
    { id: '2', type: 'bookmark', title: 'https://b.test/', url: 'https://b.test/' },
    { id: '3', type: 'bookmark', title: 'Good', url: 'https://c.test/' },
  ];
  assert.deepEqual(findUntitled(flat).map((b) => [b.id, b.reason]), [['1', 'blank'], ['2', 'url']]);
  assert.deepEqual(findUntitled(flatten(tree)).map((b) => b.id), ['b1']);
});
