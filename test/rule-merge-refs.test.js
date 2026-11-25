import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRules } from '../src/lib/rules.js';
import { validateRules } from '../src/lib/rule-plan.js';
import { roots, queryRule } from './helpers.js';

// ============================================================================
// Setup
// ============================================================================

const item = (field, operator, value) => ({ id: `${field}-${operator}-${value}`, field, operator, value, caseSensitive: false, wholeWords: false });
const any = (...rules) => ({ id: 'group', combinator: 'or', not: false, rules });

const keep = queryRule('keep', any(item('title', 'contains', 'rust')));
const other = queryRule('other', any(item('title', 'contains', 'go')));

// ============================================================================
// Merging rules that others point at
// ============================================================================

test('rule conditions pointing at the merged rule point at the kept rule, however deeply nested', () => {
  const pointing = queryRule('pointing', any(item('rule', 'doesNotMatchRule', 'other'), { id: 'inner', combinator: 'and', not: false, rules: [item('rule', 'matchesRule', 'other'), item('rule', 'matchesRule', 'keep')] }));
  const out = mergeRules([keep, other, pointing], 'keep', 'other');
  const values = out[1].query.rules.flatMap((entry) => (entry.rules ? entry.rules : [entry])).map((entry) => entry.value);

  assert.deepEqual(values, ['keep', 'keep', 'keep']);
  assert.deepEqual([...validateRules(out, roots).keys()], []);
});

test('a kept rule that pointed at the merged rule now refers to itself, which is reported', () => {
  const kept = queryRule('keep', any(item('title', 'contains', 'rust'), item('rule', 'doesNotMatchRule', 'other')));
  const out = mergeRules([kept, other], 'keep', 'other');

  assert.match(validateRules(out, roots).get('keep')[0], /back to itself/);
});
