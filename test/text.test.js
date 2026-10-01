import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byText } from '../src/lib/text.js';
import { groupBy, countBy } from '../src/lib/group.js';

test('text sorts ignoring case and accents, with numbers by value', () => {
  assert.deepEqual(['item10', 'Item2', 'éclair', 'apple'].sort(byText), ['apple', 'éclair', 'Item2', 'item10']);
});

test('items group and count by key in their original order', () => {
  const items = ['aa', 'b', 'cc', 'd'];
  assert.deepEqual([...groupBy(items, (s) => s.length)], [[2, ['aa', 'cc']], [1, ['b', 'd']]]);
  assert.deepEqual([...countBy(items, (s) => s.length)], [[2, 2], [1, 2]]);
});
