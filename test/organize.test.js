import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionMatches, ruleMatches, resolveTarget, planMoves, validateRules, duplicateRule, describeRule } from '../src/lib/organize.js';

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

test('a duplicated rule is an independent copy with its own id', () => {
  const original = rule('orig', [cond('contains', 'rust')], 'Dev', { name: 'Rust' });
  const copy = duplicateRule(original);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.name, 'Rust (copy)');
  assert.equal(copy.target, 'Dev');
  copy.conditions[0].values.push('go');
  assert.deepEqual(original.conditions[0].values, ['rust'], 'editing the copy leaves the original alone');
  assert.equal(duplicateRule(rule('x', [], 'A', { name: '' })).name, '', 'an unnamed rule stays unnamed');
});

test('rules are summed up in plain words', () => {
  const r = rule('r', [cond('contains', 'rust,cargo', { field: 'title' }), cond('domain', 'github.com'), cond('contains', '')], 'Dev', { match: 'all' });
  assert.equal(describeRule(r), 'title contains any of “cargo”, “rust” and address is on domain “github.com”');
  assert.equal(describeRule(rule('r', [cond('startsWith', 'Doc', { caseSensitive: true })], 'X')), 'title or address starts with “Doc” (exact case)');
  assert.equal(describeRule(rule('r', [cond('contains', '')], 'X')), 'No conditions yet');
});

test('summaries list keywords alphabetically, ignoring case and ordering numbers by value', () => {
  const r = rule('r', [{ field: 'title', op: 'contains', values: ['zeta', 'Alpha', 'item10', 'item2', 'beta'] }], 'X');
  assert.equal(describeRule(r), 'title contains any of “Alpha”, “beta”, “item2”, “item10”, “zeta”');
});

const group = (match, conditions) => ({ type: 'group', match, conditions });

test('groups nest with any, all and none', () => {
  const rustNotReddit = rule('r', [
    cond('contains', 'rust', { field: 'title' }),
    group('none', [cond('domain', 'reddit.com'), cond('contains', 'meme', { field: 'title' })]),
  ], 'Dev', { match: 'all' });
  assert.ok(ruleMatches(rustNotReddit, bm('1', 'Rust book', 'https://doc.rust-lang.org/')));
  assert.ok(!ruleMatches(rustNotReddit, bm('2', 'Rust thread', 'https://www.reddit.com/r/rust')));
  assert.ok(!ruleMatches(rustNotReddit, bm('3', 'Rust meme', 'https://x.test/')));
  assert.ok(!ruleMatches(rustNotReddit, bm('4', 'Go book', 'https://go.dev/')));

  const either = rule('e', [group('all', [cond('contains', 'a', { field: 'title' }), cond('contains', 'b', { field: 'title' })]), cond('contains', 'z', { field: 'title' })], 'X');
  assert.ok(ruleMatches(either, bm('1', 'ab', 'https://q.test')));
  assert.ok(ruleMatches(either, bm('2', 'z', 'https://q.test')));
  assert.ok(!ruleMatches(either, bm('3', 'a', 'https://q.test')));
});

test('a top-level none rule matches bookmarks that meet none of its conditions', () => {
  const r = rule('n', [cond('contains', 'work,job', { field: 'title' })], 'Personal', { match: 'none' });
  assert.ok(ruleMatches(r, bm('1', 'Holiday photos', 'https://p.test')));
  assert.ok(!ruleMatches(r, bm('2', 'Job board', 'https://p.test')));
});

test('empty groups are ignored and a rule made only of them never matches', () => {
  const r = rule('r', [group('none', [cond('contains', '')]), cond('contains', 'rust')], 'X');
  assert.ok(ruleMatches(r, bm('1', 'rust', 'https://a.test')));
  const empty = rule('e', [group('none', [cond('contains', '')])], 'X');
  assert.ok(!ruleMatches(empty, bm('1', 'anything', 'https://a.test')));
  assert.deepEqual(validateRules([empty], roots).get('e'), ['Add at least one keyword to a condition.']);
});

test('nested groups are summed up with brackets and "not"', () => {
  const r = rule('r', [
    cond('contains', 'rust', { field: 'title' }),
    group('none', [cond('domain', 'reddit.com'), cond('contains', 'meme', { field: 'title' })]),
    group('any', [cond('contains', 'book', { field: 'title' })]),
  ], 'Dev', { match: 'all' });
  assert.equal(describeRule(r), 'title contains any of “rust” and not (address is on domain “reddit.com” or title contains any of “meme”) and title contains any of “book”');
});

test('invalid regexes inside nested groups are reported', () => {
  const r = rule('r', [cond('contains', 'x'), group('all', [group('any', [{ field: 'title', op: 'regex', values: ['('] }])])], 'X');
  assert.equal(validateRules([r], roots).get('r').length, 1);
});

test('a none group always gets brackets, even with one condition', () => {
  const r = rule('r', [cond('contains', 'work')], 'X', { match: 'none' });
  assert.equal(describeRule(r), 'not (title or address contains any of “work”)');
});
