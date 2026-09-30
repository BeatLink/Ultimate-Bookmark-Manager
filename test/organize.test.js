import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionMatches, ruleMatches, resolveTarget, planMoves, validateRules } from '../src/lib/organize.js';

const roots = [
  { id: 'menu________', title: 'Bookmarks Menu' },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar' },
  { id: 'unfiled_____', title: 'Other Bookmarks' },
];
const bm = (id, title, url, path = ['Bookmarks Menu']) => ({ id, title, url, type: 'bookmark', path });
const cond = (op, words, extra = {}) => ({ field: 'either', op, values: words ? words.split(',') : [], caseSensitive: false, ...extra });
const rule = (id, conditions, target, extra = {}) => ({ id, name: id, enabled: true, match: 'any', conditions, target, ...extra });

test('contains matches any comma-separated word in title or address, ignoring case', () => {
  const b = bm('1', 'Learn RUST today', 'https://example.com/x');
  assert.ok(conditionMatches(cond('contains', 'python, rust'), b));
  assert.ok(!conditionMatches(cond('contains', 'rust', { caseSensitive: true }), b));
  assert.ok(!conditionMatches(cond('contains', 'rust', { field: 'url' }), b));
});

test('operators behave as named', () => {
  const b = bm('1', 'News: world', 'https://news.bbc.co.uk/a');
  assert.ok(conditionMatches(cond('containsAll', 'news, world', { field: 'title' }), b));
  assert.ok(!conditionMatches(cond('containsAll', 'news, sport', { field: 'title' }), b));
  assert.ok(conditionMatches(cond('notContains', 'sport'), b));
  assert.ok(!conditionMatches(cond('notContains', 'bbc'), b), 'none-of must hold for both fields');
  assert.ok(conditionMatches(cond('startsWith', 'news', { field: 'title' }), b));
  assert.ok(conditionMatches(cond('endsWith', '/a', { field: 'url' }), b));
  assert.ok(conditionMatches(cond('equals', 'news: world', { field: 'title' }), b));
  assert.ok(conditionMatches(cond('domain', 'bbc.co.uk'), b));
  assert.ok(!conditionMatches(cond('domain', 'co.uk.evil'), b));
  assert.ok(conditionMatches(cond('regex', '^https://news\\.'), b));
});

test('match all needs every condition; empty conditions never match', () => {
  const b = bm('1', 'Rust book', 'https://doc.rust-lang.org/book');
  assert.ok(ruleMatches(rule('r', [cond('contains', 'rust'), cond('domain', 'github.com')], 'X'), b));
  assert.ok(!ruleMatches(rule('r', [cond('contains', 'rust'), cond('domain', 'github.com')], 'X', { match: 'all' }), b));
  assert.ok(!ruleMatches(rule('r', [cond('contains', '')], 'X'), b));
});

test('targets resolve against root titles and aliases, else go under Other Bookmarks', () => {
  assert.deepEqual(resolveTarget('Bookmarks Toolbar/Dev', roots), { rootId: 'toolbar_____', path: ['Bookmarks Toolbar', 'Dev'], segments: ['Dev'] });
  assert.equal(resolveTarget('menu / A / B', roots).rootId, 'menu________');
  assert.deepEqual(resolveTarget('Reading/News', roots).path, ['Other Bookmarks', 'Reading', 'News']);
  assert.equal(resolveTarget('  ', roots), null);
});

test('first matching rule wins and bookmarks already inside the target are skipped', () => {
  const flat = [
    bm('a', 'Rust news', 'https://a.test'),
    bm('b', 'Rust guide', 'https://b.test', ['Other Bookmarks', 'Dev', 'Rust']),
    bm('c', 'Cooking', 'https://c.test'),
  ];
  const rules = [rule('news', [cond('contains', 'news')], 'Reading'), rule('dev', [cond('contains', 'rust')], 'Other Bookmarks/Dev')];
  const { moves } = planMoves(flat, rules, roots);
  assert.deepEqual(moves.map((m) => [m.bookmark.id, m.ruleId]), [['a', 'news']]);
});

test('invalid and disabled rules are left out of the plan', () => {
  const flat = [bm('a', 'x', 'https://a.test')];
  const rules = [rule('bad', [cond('regex', '(')], 'A'), rule('off', [cond('contains', 'x')], 'B', { enabled: false }), rule('notarget', [cond('contains', 'x')], '')];
  assert.equal(planMoves(flat, rules, roots).moves.length, 0);
  assert.deepEqual([...validateRules(rules, roots).keys()], ['bad', 'notarget']);
});

test('keywords may contain commas, and older comma-separated values still work', () => {
  const b = bm('1', 'Smith, John — profile', 'https://a.test');
  assert.ok(conditionMatches({ field: 'title', op: 'contains', values: ['Smith, John'] }, b));
  assert.ok(!conditionMatches({ field: 'title', op: 'contains', values: ['Smith, Jane'] }, b));
  assert.ok(conditionMatches({ field: 'title', op: 'contains', value: 'nobody, profile' }, b));
});

test('regex conditions match when any pattern does, and each bad pattern is reported', () => {
  const b = bm('1', 'Issue 1234', 'https://a.test');
  assert.ok(conditionMatches({ field: 'title', op: 'regex', values: ['^PR', '\\d{3,4}$'] }, b));
  const bad = rule('bad', [{ field: 'title', op: 'regex', values: ['(', 'ok', '['] }], 'X');
  assert.equal(validateRules([bad], roots).get('bad').length, 2);
});
