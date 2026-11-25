import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, settle, uninstallDom } from './browser-env.js';

installDom();
const { mountQueryEditor } = await import('../src/ui/query-editor.js');

after(uninstallDom);

// ============================================================================
// Setup
// ============================================================================

const root = { id: 'root________', children: [{ id: 'menu________', title: 'Bookmarks Menu', children: [] }] };
const query = (value) => ({ id: 'top', combinator: 'or', not: false, rules: [{ id: 'c-rule', field: 'rule', operator: 'matchesRule', value }] });
const regex = () => ({ id: 'top', combinator: 'or', not: false, rules: [{ id: 'c-text', field: 'title', operator: 'contains', value: 'x', caseSensitive: false, wholeWords: false }] });

const own = { id: 'own', name: 'Own rule', query: query('') };
const work = { id: 'work', name: 'Work sites', query: { id: 'q', combinator: 'or', not: false, rules: [{ id: 'k', field: 'title', operator: 'contains', value: 'work' }] } };
const play = { id: 'play', name: '', query: { id: 'q2', combinator: 'or', not: false, rules: [] } };

function mount(start, rules = [own, work, play]) {
  const box = document.createElement('div');
  document.body.append(box);
  const changes = [];
  const unmount = mountQueryEditor(box, start, (next) => changes.push(structuredClone(next)), { root, moveToNewRule: () => {}, rules, ruleId: 'own' });
  const byId = (id) => box.querySelector(`[data-rule-id="${id}"]`);
  return { box, changes, unmount, byId, last: () => changes.at(-1) };
}

// ============================================================================
// Choosing a rule
// ============================================================================

test('a rule condition shows its rule by name and lists the other rules to choose from', async () => {
  const ed = mount(query(''));
  const button = ed.byId('c-rule').querySelector('button[aria-label=Rule]');
  assert.equal(button.textContent, 'Choose rule…');
  assert.ok(button.classList.contains('unset'));

  button.click();
  const dialog = document.querySelector('dialog.folder-picker');
  const labels = [...dialog.querySelectorAll('.rule-choice')].map((choice) => choice.textContent);
  assert.deepEqual(labels, ['Work sites', 'Unnamed rule'], 'the rule being edited is not offered');

  dialog.querySelector('.rule-choice[data-id="work"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await settle();
  assert.equal(ed.last().rules[0].value, 'work');
  assert.equal(ed.byId('c-rule').querySelector('button[aria-label=Rule]').textContent, 'Work sites');
  ed.unmount();
});

test('choosing the same rule again, or cancelling, changes nothing', async () => {
  const ed = mount(query('work'));
  const before = ed.changes.length;

  ed.byId('c-rule').querySelector('button[aria-label=Rule]').click();
  document.querySelector('dialog.folder-picker .rule-choice[data-id="work"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await settle();
  ed.byId('c-rule').querySelector('button[aria-label=Rule]').click();
  document.querySelector('dialog.folder-picker').close('cancel');
  await settle();

  assert.equal(ed.changes.length, before);
  ed.unmount();
});

test('a rule that no longer exists is shown as deleted', () => {
  const ed = mount(query('gone'));

  assert.equal(ed.byId('c-rule').querySelector('button[aria-label=Rule]').textContent, 'A deleted rule');
  ed.unmount();
});

test('a rule condition offers matches and does not match, and no case or whole-word switches', () => {
  const ed = mount(query('work'));
  const operators = [...ed.byId('c-rule').querySelectorAll('.rule-operators option')].map((option) => option.textContent);

  assert.deepEqual(operators, ['matches', 'does not match']);
  assert.equal(ed.byId('c-rule').querySelector('.rule-case input').disabled, true);
  assert.equal(ed.byId('c-rule').querySelector('.rule-words input').disabled, true);
  ed.unmount();
});

// ============================================================================
// Switching fields
// ============================================================================

test('switching a text condition to the rule field clears its keyword, and back again', () => {
  const ed = mount(regex());
  const field = ed.byId('c-text').querySelector('.rule-fields');

  field.value = 'rule';
  field.dispatchEvent(new Event('change', { bubbles: true }));
  assert.deepEqual([ed.last().rules[0].field, ed.last().rules[0].operator, ed.last().rules[0].value], ['rule', 'matchesRule', '']);

  const back = ed.byId('c-text').querySelector('.rule-fields');
  back.value = 'title';
  back.dispatchEvent(new Event('change', { bubbles: true }));
  assert.deepEqual([ed.last().rules[0].field, ed.last().rules[0].operator, ed.last().rules[0].value], ['title', 'contains', '']);
  ed.unmount();
});

test('does not match regex is offered for text fields and its keyword is shown as code', () => {
  const ed = mount({ id: 'top', combinator: 'or', not: false, rules: [{ id: 'c-neg', field: 'title', operator: 'doesNotMatchRegex', value: '^a', caseSensitive: false, wholeWords: false }] });
  const operators = [...ed.byId('c-neg').querySelectorAll('.rule-operators option')].map((option) => option.textContent);

  assert.ok(operators.includes('does not match regex'));
  assert.ok(ed.byId('c-neg').querySelector('input.keyword').classList.contains('mono'));
  ed.unmount();
});
