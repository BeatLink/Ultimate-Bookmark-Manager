import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierOf, buildOrder, eligibleToOutrank, eligibleToRankBelow, builtInBeats, rankCandidates, lostBecause, dropRetiredRanking } from '../src/lib/rule-order.js';

const rule = (id, outranks = [], extra = {}) => ({ id, name: id, outranks, ...extra });
const fmt = (s) => `#${s}`;

test('rules ranked above or below all others sit in their own tiers', () => {
  assert.equal(tierOf(rule('a', [], { rankAll: 'above' })), 2);
  assert.equal(tierOf(rule('a')), 1);
  assert.equal(tierOf(rule('a', [], { rankAll: 'below' })), 0);
});

test('the order follows ranking lists through other rules', () => {
  const order = buildOrder([rule('a', ['b']), rule('b', ['c']), rule('c'), rule('d', ['missing'])]);
  assert.ok(order.ranksAbove('a', 'c'));
  assert.ok(!order.ranksAbove('c', 'a'));
  assert.ok(!order.ranksAbove('d', 'missing'));
  assert.ok(!order.ranksAbove('unknown', 'a'));
  assert.deepEqual(order.loops, []);
});

test('links inside a loop, to the rule itself, or against the tiers are ignored and reported', () => {
  const top = rule('top', [], { rankAll: 'above' });
  const order = buildOrder([rule('a', ['b']), rule('b', ['a']), rule('self', ['self']), rule('low', ['top']), top]);
  assert.deepEqual(order.loops.map((g) => g.map((r) => r.id).sort()), [['a', 'b'], ['self']]);
  assert.ok(!order.ranksAbove('a', 'b') && !order.ranksAbove('b', 'a'));
  assert.ok(!order.ranksAbove('low', 'top'));
  assert.deepEqual(order.against.map(([hi, lo]) => [hi.id, lo.id]), [['low', 'top']]);
});

test('a rule may outrank or rank below only rules that make no loop and respect the tiers', () => {
  const rules = [rule('a', ['b']), rule('b'), rule('c'), rule('top', [], { rankAll: 'above' })];
  assert.deepEqual(eligibleToOutrank(rules[1], rules).map((r) => r.id), ['c']);
  assert.deepEqual(eligibleToOutrank(rules[3], rules).map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual(eligibleToRankBelow(rules[0], rules).map((r) => r.id), ['c', 'top']);
  assert.deepEqual(eligibleToRankBelow(rules[1], rules).map((r) => r.id), ['c', 'top']);
});

test('the built-in ranking prefers the higher score, then the newer rule, then the later one in the list', () => {
  const c = (score, createdAt, index) => ({ score, index, rule: rule('x', [], { createdAt }) });
  assert.ok(builtInBeats(c(2, 0, 0), c(1, 9, 9)));
  assert.ok(builtInBeats(c(1, 5, 0), c(1, 4, 9)));
  assert.ok(builtInBeats(c(1, undefined, 2), c(1, undefined, 1)));
  assert.ok(!builtInBeats(c(1, undefined, 1), c(1, undefined, 2)));
});

test('candidates are ranked by tier, then by the lists, then by the built-in ranking', () => {
  const rules = [rule('weak', ['strong']), rule('strong'), rule('top', [], { rankAll: 'above' })];
  const order = buildOrder(rules);
  const cands = [
    { rule: rules[1], score: 90, index: 1 },
    { rule: rules[0], score: 10, index: 0 },
    { rule: rules[2], score: 1, index: 2 },
  ];
  assert.deepEqual(rankCandidates(cands, order).map((c) => c.rule.id), ['top', 'weak', 'strong']);
});

test('a losing rule is told why it lost in plain words', () => {
  const order = buildOrder([rule('w', ['l']), rule('l')]);
  const none = buildOrder([]);
  const c = (r, score = 1) => ({ rule: r, score });
  const top = c(rule('t', [], { rankAll: 'above', name: '' }));
  const bottom = c(rule('b', [], { rankAll: 'below' }));
  const mid = c(rule('m'));
  assert.equal(lostBecause(mid, top, [], none, fmt), '“Unnamed rule” ranks above all other rules');
  assert.equal(lostBecause(bottom, mid, [], none, fmt), 'this rule ranks below all other rules');
  const winner = c(rule('w', ['l']));
  const loser = c(rule('l'));
  assert.equal(lostBecause(loser, winner, [winner, loser], order, fmt), 'ranked below “w” by your rule order');
  assert.equal(lostBecause(c(rule('x', [], { name: '' })), c(rule('y'), 2), [], none, fmt), 'less specific (#1 vs #2)');
  assert.equal(lostBecause(c(rule('x', [], { createdAt: 1 })), c(rule('y', [], { createdAt: 2 })), [], none, fmt), 'older rule, equally specific');
  assert.equal(lostBecause(c(rule('x')), c(rule('y')), [], none, fmt), 'earlier in the list, equally specific');
});

test('retired priority numbers and fallback flags are dropped and other rules returned as they are', () => {
  const plain = rule('a');
  const [kept, cleaned] = dropRetiredRanking([plain, { ...rule('b'), priority: 2, fallback: false }]);
  assert.equal(kept, plain);
  assert.deepEqual(cleaned, rule('b'));
});
