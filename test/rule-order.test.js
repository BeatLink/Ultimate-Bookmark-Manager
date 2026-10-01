import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrder, eligibleToOutrank, eligibleToRankBelow, rankCandidates, lostBecause } from '../src/lib/rule-order.js';

const cand = (rule, score) => ({ rule, score, index: 0 });

test('ranking lists follow through other rules', () => {
  const a = { id: 'a', name: 'A', outranks: ['b'] };
  const b = { id: 'b', name: 'B', outranks: ['c'] };
  const c = { id: 'c', name: 'C', outranks: [] };
  const d = { id: 'd', name: 'D', outranks: [] };
  const order = buildOrder([a, b, c, d]);
  assert.ok(order.ranksAbove('a', 'c'), 'A ranks above C through B');
  assert.ok(!order.ranksAbove('c', 'a') && !order.ranksAbove('a', 'd'));
  assert.deepEqual(eligibleToOutrank(c, [a, b, c, d]).map((r) => r.id), ['d'], 'C cannot list A or B: that would make a loop');
  assert.deepEqual(eligibleToOutrank(a, [a, b, c, d]).map((r) => r.id), ['c', 'd'], 'already listed and itself are left out');
  const ranked = rankCandidates([cand(c, 900), cand(d, 50), cand(a, 20), cand(b, 10)], order);
  assert.deepEqual(ranked.map((x) => x.rule.id), ['d', 'a', 'b', 'c'], 'C scores highest but A and B both rank above it');
});

test('links inside a loop are ignored', () => {
  const loopA = { id: 'a', name: 'A', outranks: ['b'] };
  const loopB = { id: 'b', name: 'B', outranks: ['a'] };
  const order = buildOrder([loopA, loopB, { id: 'c', name: 'C', outranks: [] }]);
  assert.ok(!order.ranksAbove('a', 'b') && !order.ranksAbove('b', 'a'));
  assert.equal(order.loops.length, 1);
});

test('rules can rank above or below all other rules, and links against those tiers are ignored', () => {
  const top = { id: 't', name: 'Top', rankAll: 'above', outranks: [] };
  const top2 = { id: 't2', name: 'Top 2', rankAll: 'above', outranks: ['t'] };
  const mid = { id: 'm', name: 'Mid', outranks: [] };
  const low = { id: 'l', name: 'Low', rankAll: 'below', outranks: [] };
  const rules = [top, top2, mid, low];
  const ranked = rankCandidates([cand(low, 900), cand(mid, 500), cand(top, 10), cand(top2, 5)], buildOrder(rules));
  assert.deepEqual(ranked.map((x) => x.rule.id), ['t2', 't', 'm', 'l'], 'tiers first, then links within a tier, then score');
  assert.match(lostBecause(ranked[2], ranked[0], ranked, buildOrder(rules), String), /“Top 2” ranks above all other rules/);
  assert.match(lostBecause(ranked[3], ranked[2], ranked, buildOrder(rules), String), /ranks below all other rules/);

  assert.deepEqual(eligibleToOutrank(mid, rules).map((r) => r.id), ['l'], 'a middle rule cannot rank above a top one');
  assert.deepEqual(eligibleToRankBelow(mid, rules).map((r) => r.id), ['t', 't2'], 'but it can rank below one');
  assert.deepEqual(eligibleToOutrank(top, rules).map((r) => r.id), ['m', 'l'], 'Top 2 already ranks above Top, so Top cannot list it');

  const order = buildOrder([top, { ...mid, outranks: ['t'] }]);
  assert.ok(!order.ranksAbove('m', 't'), 'a link against the tiers is ignored');
  assert.equal(order.against.length, 1);
});

test('a loser is told whether a list, the score or the rule age decided', () => {
  const older = { id: 'o', name: 'Old', createdAt: 1 };
  const newer = { id: 'n', name: 'New', createdAt: 2 };
  const order = buildOrder([older, newer]);
  assert.equal(lostBecause(cand(older, 20), cand(newer, 20), [], order, String), 'older rule, equally specific');
  assert.equal(lostBecause(cand(older, 10), cand(newer, 20), [], order, String), 'less specific (10 vs 20)');
  assert.equal(lostBecause(cand({ id: 'x' }, 5), cand({ id: 'y' }, 5), [], order, String), 'earlier in the list, equally specific');
});
