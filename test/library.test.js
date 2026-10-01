import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, nextAfterRemoval } from '../src/lib/library.js';

const items = [
  { id: 'f', type: 'folder', title: 'Dev', url: undefined, path: ['Menu'] },
  { id: 'a', type: 'bookmark', title: 'Rust book', url: 'https://doc.rust-lang.org/', path: ['Menu', 'Dev'] },
  { id: 'b', type: 'bookmark', title: 'Cooking', url: 'https://food.test/', path: ['Menu'] },
  { id: 's', type: 'separator', title: '', url: undefined, path: ['Menu'] },
];
const found = (opts) => items.filter((i) => matchesSearch(i, { query: '', filter: 'all', ...opts })).map((i) => i.id);

test('a search matches the name, URL or folder path, never separators', () => {
  assert.deepEqual(found({ query: 'rust' }), ['a']);
  assert.deepEqual(found({ query: 'dev' }), ['f', 'a'], 'the folder path counts');
  assert.deepEqual(found({}), ['f', 'a', 'b']);
});

test('the filters limit the list to bookmarks: recent ones, duplicates or non-duplicates', () => {
  assert.deepEqual(found({ filter: 'recent' }), ['a', 'b']);
  assert.deepEqual(found({ filter: 'dupes', dupeIds: new Set(['b']) }), ['b']);
  assert.deepEqual(found({ filter: 'unique', dupeIds: new Set(['b']) }), ['a']);
});

test('after a removal the focus goes to the next row outside the removed ones, else the previous', () => {
  const inside = (id, chosen) => chosen.has(id) || (id === 'a' && chosen.has('f'));
  assert.equal(nextAfterRemoval(['f', 'a', 'b', 's'], new Set(['f']), inside), 'b');
  assert.equal(nextAfterRemoval(['f', 'a', 'b', 's'], new Set(['b', 's']), inside), 'a');
  assert.equal(nextAfterRemoval(['f', 'a'], new Set(['f']), inside), null);
});
