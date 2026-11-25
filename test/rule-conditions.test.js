import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRules, validateRules } from '../src/lib/rule-plan.js';
import { ruleMatches, maxScore, explainMatch } from '../src/lib/matching.js';
import { describeRule, newCondition, FIELD_OPERATORS } from '../src/lib/rules.js';
import { roots, bm, queryRule } from './helpers.js';

// ============================================================================
// Setup
// ============================================================================

const plan = (flat, rules) => planRules(flat, rules, roots);
const item = (field, operator, value) => ({ id: `${field}-${operator}-${value}`, field, operator, value, caseSensitive: false, wholeWords: false });
const all = (...rules) => ({ id: 'group', combinator: 'and', not: false, rules });
const any = (...rules) => ({ id: 'group', combinator: 'or', not: false, rules });
const targets = (changes) => Object.fromEntries(changes.map((change) => [change.bookmark.id, change.target?.path.join('/')]));

const work = queryRule('work', any(item('title', 'contains', 'work')), 'Bookmarks Toolbar');
const general = queryRule('general', all(item('title', 'contains', 'rust'), item('rule', 'doesNotMatchRule', 'work')), 'Other Bookmarks/General');

const flat = () => [
  bm('a', 'Rust work notes', 'https://a.test'),
  bm('b', 'Rust book', 'https://b.test'),
  bm('c', 'Work only', 'https://c.test'),
];

// ============================================================================
// Does not match regex
// ============================================================================

test('does not match regex holds when no part it looks at matches', () => {
  const only_title = queryRule('t', any(item('title', 'doesNotMatchRegex', '^Rust')));
  const either = queryRule('e', any(item('either', 'doesNotMatchRegex', 'rust|work')));

  assert.equal(ruleMatches(only_title, bm('a', 'Rust book', 'https://a.test'), roots), false);
  assert.equal(ruleMatches(only_title, bm('b', 'Python', 'https://b.test'), roots), true);
  assert.equal(ruleMatches(either, bm('c', 'Python', 'https://rust.test'), roots), false, 'the URL counts as well as the title');
  assert.equal(ruleMatches(either, bm('d', 'Python', 'https://d.test'), roots), true);
  assert.equal(explainMatch(either, bm('d', 'Python', 'https://d.test'), roots).terms.length, 0);
  assert.equal(maxScore(either), 0);
});

test('an invalid pattern in does not match regex is reported', () => {
  const bad = queryRule('bad', any(item('title', 'doesNotMatchRegex', '(')));

  assert.match(validateRules([bad], roots).get('bad').join(), /Invalid regex “\(”/);
});

// ============================================================================
// Rule conditions
// ============================================================================

test('a higher rule steps aside for bookmarks a lower rule matches, so the lower rule wins', () => {
  const { changes } = plan(flat(), [general, work]);

  assert.deepEqual(targets(changes), { a: 'Bookmarks Toolbar', b: 'Other Bookmarks/General', c: 'Bookmarks Toolbar' });
  assert.deepEqual(changes.find((change) => change.bookmark.id === 'a').steps.map((step) => step.ruleId), ['work']);
});

test('stepping aside holds back every action of the higher rule, not only its move', () => {
  const rename = { ...general, actions: [...general.actions, { id: 'r', type: 'replace', find: 'Rust', replace: 'Crab', field: 'title', caseSensitive: false, regex: false }] };
  const { changes } = plan(flat(), [rename, work]);

  const stepped_aside = changes.find((change) => change.bookmark.id === 'a');
  const kept = changes.find((change) => change.bookmark.id === 'b');
  assert.deepEqual(stepped_aside.edits, {});
  assert.deepEqual(kept.edits, { title: 'Crab book' });
});

test('a rule that matches another rule only acts on what that rule matches', () => {
  const both = queryRule('both', all(item('rule', 'matchesRule', 'work'), item('title', 'contains', 'rust')), 'Mobile Bookmarks');
  const { changes } = plan(flat(), [work, both]);

  assert.equal(targets(changes).a, 'Bookmarks Toolbar', 'work comes first, so its move wins');
  assert.equal(changes.find((change) => change.bookmark.id === 'a').steps.length, 1);
  assert.equal(changes.some((change) => change.bookmark.id === 'b'), false, 'b is not work, so the rule leaves it alone');
});

test('a disabled rule can still be used as a set of conditions', () => {
  const set = { ...work, enabled: false };
  const { changes } = plan(flat(), [general, set]);

  assert.deepEqual(targets(changes), { b: 'Other Bookmarks/General' });
});

test('rule conditions follow the rule by id, whatever its name or place', () => {
  const renamed = { ...work, name: 'Something else' };

  assert.deepEqual(targets(plan(flat(), [renamed, general]).changes), targets(plan(flat(), [general, work]).changes));
  assert.equal(describeRule(general, [general, renamed]), 'title contains “rust” and rule does not match “Something else”');
  assert.equal(describeRule(general, [general]), 'title contains “rust” and rule does not match “a deleted rule”');
});

test('a rule condition without a rule chosen is left out, like any empty condition', () => {
  const half = queryRule('half', any(item('rule', 'matchesRule', '')));

  assert.deepEqual([...validateRules([half], roots).get('half')], ['Add a condition; a rule without one matches nothing.']);
});

test('matched on its own, a rule has no other rules to look at', () => {
  const matches = queryRule('m', any(item('rule', 'matchesRule', 'work')));
  const does_not = queryRule('n', any(item('rule', 'doesNotMatchRule', 'work')));

  assert.equal(ruleMatches(matches, bm('a', 'Work', 'https://a.test'), roots), false);
  assert.equal(ruleMatches(does_not, bm('a', 'Work', 'https://a.test'), roots), true);
});

// ============================================================================
// Rules that refer to missing rules or to each other
// ============================================================================

test('a rule pointing at a rule that is gone is reported and left out of the plan', () => {
  const orphan = queryRule('orphan', any(item('rule', 'matchesRule', 'gone')), 'Bookmarks Toolbar');

  assert.deepEqual(validateRules([orphan], roots).get('orphan'), ['A condition refers to a rule that no longer exists.']);
  assert.equal(plan(flat(), [orphan]).changes.length, 0);
});

test('rules that refer to themselves or to each other in a loop are reported, with every rule that depends on them', () => {
  const alone = queryRule('alone', any(item('rule', 'matchesRule', 'alone')));
  const first = queryRule('first', any(item('rule', 'matchesRule', 'second')));
  const second = queryRule('second', any(item('rule', 'doesNotMatchRule', 'first')));
  const outside = queryRule('outside', any(item('rule', 'matchesRule', 'first')));
  const fine = queryRule('fine', any(item('title', 'contains', 'x')));
  const problems = validateRules([alone, first, second, outside, fine], roots);

  assert.deepEqual([...problems.keys()], ['alone', 'first', 'second', 'outside']);
  assert.match(problems.get('alone')[0], /back to itself/);
  assert.equal(plan(flat(), [alone, first, second, outside]).changes.length, 0);
});

test('a rule that depends on a loop is left out of the plan rather than running forever', () => {
  const first = queryRule('first', any(item('rule', 'matchesRule', 'second'), item('title', 'contains', 'rust')));
  const second = queryRule('second', any(item('rule', 'matchesRule', 'first')));
  const reading = queryRule('reading', any(item('rule', 'matchesRule', 'second')), 'Bookmarks Toolbar');

  assert.equal(plan(flat(), [reading, second, first]).changes.length, 0);
});

// ============================================================================
// Building conditions
// ============================================================================

test('a rule condition starts empty, and the rule field offers only matches and does not match', () => {
  const made = newCondition('rule', 'matchesRule');

  assert.equal(made.value, '');
  assert.equal('caseSensitive' in made, false);
  assert.deepEqual(FIELD_OPERATORS.rule, ['matchesRule', 'doesNotMatchRule']);
  assert.ok(FIELD_OPERATORS.title.includes('doesNotMatchRegex'));
});
