import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newEditorGroup, itemAt, withIds, moveItem, groupItems, insertItem, addItem, removeItem, canDropOnCondition, canDropOnGroup, dropPath } from '../src/lib/query-tree.js';

const c = (id) => ({ id, field: 'title', operator: 'contains', value: id });
const g = (id, ...rules) => ({ id, combinator: 'or', not: false, rules });
// The tree's ids in order, with groups as nested lists.
const ids = (group) => group.rules.map((r) => (r.rules ? [r.id, ids(r)] : r.id));
const sample = () => g('root', c('a'), g('G', c('b'), c('c')), c('d'));

test('moving after a later sibling accounts for the item taken out first', () => {
  const q = sample();
  assert.ok(moveItem(q, [0], [3]));
  assert.deepEqual(ids(q), [['G', ['b', 'c']], 'd', 'a']);
});

test('moving into another group, and out again', () => {
  const q = sample();
  assert.ok(moveItem(q, [2], [1, 0]));
  assert.deepEqual(ids(q), ['a', ['G', ['d', 'b', 'c']]]);
  assert.ok(moveItem(q, [1, 2], [0]));
  assert.deepEqual(ids(q), ['c', 'a', ['G', ['d', 'b']]]);
});

test('a move to where the item already is, or into itself, changes nothing', () => {
  const q = sample();
  assert.equal(moveItem(q, [1], [1]), false);
  assert.equal(moveItem(q, [1], [1, 0]), false);
  assert.equal(moveItem(q, [], [0]), false);
  assert.deepEqual(ids(q), ids(sample()));
});

test('copying leaves the original and gives the copy new ids throughout', () => {
  const q = sample();
  assert.ok(moveItem(q, [1], [2], true));
  const copy = itemAt(q, [2]);
  assert.deepEqual(ids(q).slice(0, 2), ['a', ['G', ['b', 'c']]]);
  assert.notEqual(copy.id, 'G');
  assert.deepEqual(copy.rules.map((r) => r.value), ['b', 'c']);
  assert.ok(copy.rules.every((r) => !['b', 'c'].includes(r.id)));
});

test('grouping puts the dropped item after the target in a new "all" group where the target was', () => {
  const q = sample();
  assert.ok(groupItems(q, [0], [2]));
  const made = itemAt(q, [1]);
  assert.equal(made.combinator, 'and');
  assert.deepEqual(ids(q), [['G', ['b', 'c']], [made.id, ['d', 'a']]]);
});

test('nothing can be grouped with the top group', () => {
  const q = sample();
  assert.equal(canDropOnGroup([0], [], true), false);
  assert.equal(groupItems(q, [0], []), false);
  assert.deepEqual(ids(q), ids(sample()));
});

test('items from another rule are inserted under new ids, or added with theirs', () => {
  const q = sample();
  assert.ok(insertItem(q, c('x'), [1, 1]));
  assert.notEqual(itemAt(q, [1, 1]).id, 'x');
  assert.equal(itemAt(q, [1, 1]).value, 'x');
  addItem(q, c('y'));
  assert.equal(itemAt(q, [3]).id, 'y');
});

test('removing takes out the item and everything in it', () => {
  const q = sample();
  assert.ok(removeItem(q, [1]));
  assert.deepEqual(ids(q), ['a', 'd']);
  assert.equal(removeItem(q, []), false);
});

test('drop rules: not onto itself, inside itself, or just after the item before it', () => {
  assert.equal(canDropOnCondition([1], [1, 0], false), false);
  assert.equal(canDropOnCondition([2], [2], false), false);
  assert.equal(canDropOnCondition([2], [1], false), false);
  assert.equal(canDropOnCondition([2], [1], true), true, 'grouping with the item before is allowed');
  assert.equal(canDropOnCondition([0], [2], false), true);
  assert.equal(canDropOnGroup([1, 0], [1], false), false, 'already first in that group');
  assert.equal(canDropOnGroup([1, 1], [1], false), true);
  assert.equal(canDropOnGroup([1], [1], false), false);
});

test('a drop lands after a condition, first in a group, or in place of the target when grouping', () => {
  assert.deepEqual(dropPath([1, 0], 'condition', false), [1, 1]);
  assert.deepEqual(dropPath([1], 'group', false), [1, 0]);
  assert.deepEqual(dropPath([1, 0], 'condition', true), [1, 0]);
});

test('missing ids are filled in and existing ones kept', () => {
  const q = withIds({ combinator: 'or', rules: [{ id: 'keep', field: 'title' }, { rules: [{ field: 'url' }] }] });
  assert.ok(q.id);
  assert.equal(q.rules[0].id, 'keep');
  assert.ok(q.rules[1].id && q.rules[1].rules[0].id);
});

test('a new editor group holds one empty keyword condition and every id is unique', () => {
  const a = newEditorGroup();
  const b = newEditorGroup();
  assert.equal(a.combinator, 'and');
  assert.equal(a.not, false);
  assert.equal(a.rules.length, 1);
  assert.equal(a.rules[0].value, '');
  assert.equal(new Set([a.id, b.id, a.rules[0].id, b.rules[0].id]).size, 4);
});
