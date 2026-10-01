import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, settle, uninstallDom } from './browser-env.js';

installDom();
const { mountQueryEditor } = await import('../src/ui/query-editor.js');

after(uninstallDom);

const cond = (field, operator, value, extra = {}) => ({ id: `c-${value || field}`, field, operator, value, caseSensitive: false, wholeWords: false, ...extra });
const sampleQuery = () => ({
  id: 'top', combinator: 'or', not: false, rules: [
    cond('title', 'contains', 'rust'),
    { id: 'inner', combinator: 'and', not: true, rules: [cond('url', 'beginsWith', 'https')] },
    { id: 'c-folder', field: 'folder', operator: 'inFolder', value: 'Bookmarks Menu/Dev' },
  ],
});
const root = { id: 'root________', children: [
  { id: 'menu________', title: 'Bookmarks Menu', children: [{ id: 'dev', title: 'Dev', children: [] }, { id: 'news', title: 'News', children: [] }] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [] },
] };

// Mounts an editor in a fresh box and records every query it reports.
function mount(query = sampleQuery(), options = {}) {
  const box = document.createElement('div');
  document.body.append(box);
  const changes = [];
  const moved = [];
  const unmount = mountQueryEditor(box, query, (q) => changes.push(structuredClone(q)), { root, moveToNewRule: (id) => moved.push(id), ...options });
  const $ = (sel) => box.querySelector(sel);
  const $$ = (sel) => [...box.querySelectorAll(sel)];
  const last = () => changes.at(-1);
  const byId = (id) => box.querySelector(`[data-rule-id="${id}"], [data-rule-group-id="${id}"]`);
  return { box, changes, moved, unmount, $, $$, last, byId };
}

const values = (group) => group.rules.map((r) => (r.rules ? values(r) : r.value));

function setValue(el, value, type = 'change') {
  el.value = value;
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function setChecked(el, checked) {
  el.checked = checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const key = (type, k, code) => document.dispatchEvent(new KeyboardEvent(type, { key: k, code }));

// Fires a drag event with a stand-in dataTransfer, which happy-dom does not supply.
function drag(el, type, extra = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = { data: {}, setData(k, v) { this.data[k] = v; }, setDragImage(...args) { this.image = args; }, effectAllowed: '', dropEffect: '' };
  Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
  for (const [k, v] of Object.entries({ clientX: 10, clientY: 10, altKey: false, ...extra })) Object.defineProperty(e, k, { value: v });
  el.dispatchEvent(e);
  return { event: e, dataTransfer };
}

const handleOf = (el) => el.querySelector(':scope > .queryBuilder-dragHandle, :scope > .ruleGroup-header > .queryBuilder-dragHandle');
const headerOf = (el) => el.querySelector(':scope > .ruleGroup-header');

test('the editor draws each condition and group with its settings', () => {
  const ed = mount();
  const top = ed.byId('top');
  assert.equal(top.querySelector('.ruleGroup-combinators').value, 'any');
  assert.equal(top.querySelector('.ruleGroup-combinators').getAttribute('aria-label'), 'Rule');
  assert.equal(handleOf(top), null, 'the top group cannot be dragged');
  assert.equal(top.querySelector(':scope > .ruleGroup-header .ruleGroup-remove'), null);

  const inner = ed.byId('inner');
  assert.ok(handleOf(inner));

  const title = ed.byId('c-rust');
  assert.equal(title.querySelector('.rule-fields').value, 'title');
  assert.equal(title.querySelector('.rule-operators').value, 'contains');
  assert.equal(title.querySelector('.keyword').value, 'rust');
  assert.equal(title.querySelector('.keyword').placeholder, 'Keyword');

  const folder = ed.byId('c-folder');
  assert.equal(folder.querySelector('.folder-button').textContent, 'Bookmarks Menu › Dev');
  assert.ok(folder.querySelector('.rule-case').classList.contains('unused'), 'case does not apply to folders');
  assert.equal(folder.querySelector('[aria-label="Match case"]').disabled, true);
  assert.equal(ed.changes.length, 0, 'drawing reports nothing');
  ed.unmount();
  assert.equal(ed.box.childElementCount, 0);
});

test('an unknown combinator shows as any, and an item without an id or value is still drawn', () => {
  const ed = mount({ combinator: 'xor', rules: [{ field: 'title', operator: 'contains' }, { id: 'f', field: 'folder', operator: 'inFolder' }] });
  assert.equal(ed.$('.ruleGroup-combinators').value, 'any');
  assert.ok(ed.$('.rule').dataset.ruleId);
  assert.equal(ed.$('.keyword').value, '');
  assert.equal(ed.$('.folder-button').textContent, 'Choose folder…');
  const over = drag(ed.$('.rule'), 'dragover');
  assert.equal(over.event.defaultPrevented, false, 'nothing is being dragged');
  ed.unmount();
});

test('typing a keyword reports the query with the new keyword', () => {
  const ed = mount();
  const input = ed.byId('c-rust').querySelector('.keyword');
  setValue(input, 'rust');
  assert.equal(ed.changes.length, 0, 'the same text reports nothing');
  setValue(input, 'python', 'input');
  assert.equal(ed.last().rules[0].value, 'python');
  assert.equal(ed.box.querySelector('.keyword'), input, 'typing does not redraw');
  ed.unmount();
});

test('a new field keeps the keyword and picks contains, but a switch to or from folder clears it', () => {
  const ed = mount();
  const field = () => ed.byId('c-rust').querySelector('.rule-fields');
  setValue(field(), 'title');
  assert.equal(ed.changes.length, 0);
  setValue(field(), 'url');
  assert.deepEqual([ed.last().rules[0].field, ed.last().rules[0].operator, ed.last().rules[0].value], ['url', 'contains', 'rust']);
  setValue(field(), 'folder');
  assert.deepEqual([ed.last().rules[0].field, ed.last().rules[0].operator, ed.last().rules[0].value], ['folder', 'inFolder', '']);
  assert.equal(ed.byId('c-rust').querySelector('.folder-button').textContent, 'Choose folder…');
  assert.ok(ed.byId('c-rust').querySelector('.folder-button').classList.contains('unset'));

  setValue(ed.byId('c-folder').querySelector('.rule-fields'), 'host');
  const changed = ed.last().rules[2];
  assert.deepEqual([changed.field, changed.operator, changed.value], ['host', 'contains', '']);
  ed.unmount();
});

test('the operator decides the placeholder and which switches apply', () => {
  const ed = mount();
  const row = () => ed.byId('c-rust');
  setValue(row().querySelector('.rule-operators'), 'contains');
  assert.equal(ed.changes.length, 0);
  setValue(row().querySelector('.rule-operators'), 'matchesRegex');
  assert.equal(ed.last().rules[0].operator, 'matchesRegex');
  assert.ok(row().querySelector('.keyword').classList.contains('mono'));
  assert.equal(row().querySelector('.keyword').placeholder, 'Pattern');
  assert.equal(row().querySelector('[aria-label="Whole words"]').disabled, true);
  assert.equal(row().querySelector('[aria-label="Match case"]').disabled, false);

  setValue(row().querySelector('.rule-fields'), 'host');
  setValue(row().querySelector('.rule-operators'), 'onDomain');
  assert.equal(row().querySelector('.keyword').placeholder, 'example.com');
  assert.equal(row().querySelector('[aria-label="Match case"]').disabled, true);
  ed.unmount();
});

test('the case and whole-word switches report their new state', () => {
  const ed = mount();
  const caseBox = ed.byId('c-rust').querySelector('[aria-label="Match case"]');
  const words = ed.byId('c-rust').querySelector('[aria-label="Whole words"]');
  setChecked(caseBox, false);
  assert.equal(ed.changes.length, 0);
  setChecked(caseBox, true);
  setChecked(words, true);
  assert.equal(ed.last().rules[0].caseSensitive, true);
  assert.equal(ed.last().rules[0].wholeWords, true);
  ed.unmount();
});

test('the combinator menu sets any, all, none and not all', () => {
  const ed = mount();
  const select = () => ed.byId('top').querySelector('.ruleGroup-combinators');
  setValue(select(), 'none');
  assert.deepEqual([ed.last().combinator, ed.last().not], ['or', true]);
  setValue(select(), 'all');
  assert.deepEqual([ed.last().combinator, ed.last().not], ['and', false]);
  setValue(ed.byId('inner').querySelector('.ruleGroup-combinators'), 'any');
  assert.deepEqual([ed.last().rules[1].combinator, ed.last().rules[1].not], ['or', false]);
  ed.unmount();
});

test('the add, copy and remove buttons change the tree', () => {
  const ed = mount();
  ed.byId('top').querySelector('.ruleGroup-addRule').click();
  assert.equal(ed.last().rules.length, 4);
  assert.deepEqual([ed.last().rules[3].field, ed.last().rules[3].operator, ed.last().rules[3].value], ['either', 'contains', '']);

  ed.byId('inner').querySelector('.ruleGroup-addGroup').click();
  const added = ed.last().rules[1].rules[1];
  assert.equal(added.combinator, 'and');
  assert.equal(added.rules.length, 1);

  ed.byId('c-rust').querySelector('.rule-cloneRule').click();
  assert.deepEqual(values(ed.last()).slice(0, 2), ['rust', 'rust']);
  assert.notEqual(ed.last().rules[0].id, ed.last().rules[1].id, 'the copy has its own id');

  ed.byId('inner').querySelector('.ruleGroup-cloneGroup').click();
  assert.deepEqual(values(ed.last()).slice(2, 4), [['https', ['']], ['https', ['']]]);

  ed.byId('c-folder').querySelector('.keyword-remove').click();
  assert.ok(!JSON.stringify(ed.last()).includes('Bookmarks Menu/Dev'));

  ed.byId('inner').querySelector('.ruleGroup-remove').click();
  assert.ok(!ed.last().rules.some((r) => r.id === 'inner'));
  ed.unmount();
});

test('the move button hands the item id to the rule list', () => {
  const ed = mount();
  ed.byId('c-rust').querySelector('[aria-label="Move to a new rule"]').click();
  ed.byId('inner').querySelector(':scope > .ruleGroup-header [aria-label="Move to a new rule"]').click();
  assert.deepEqual(ed.moved, ['c-rust', 'inner']);
  ed.unmount();
});

test('a change keeps focus on the same control after the redraw', () => {
  const ed = mount();
  const add = ed.byId('inner').querySelector('.ruleGroup-addRule');
  add.focus();
  add.click();
  assert.notEqual(document.activeElement, add, 'the old button is gone');
  assert.ok(document.activeElement.classList.contains('ruleGroup-addRule'));
  assert.equal(document.activeElement.closest('.ruleGroup').dataset.ruleGroupId, 'inner');
  ed.unmount();
});

test('the folder button picks a folder from the bookmark tree', async () => {
  const ed = mount();
  ed.byId('c-folder').querySelector('.folder-button').click();
  let dialog = document.querySelector('dialog.folder-picker');
  assert.equal(dialog.querySelector('h2').textContent, 'Choose a folder');
  assert.equal(dialog.querySelector('input[aria-label="New subfolder name"]'), null, 'no new folders here');
  dialog.querySelector('.folder-name[data-path="Bookmarks Menu/News"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await settle();
  assert.equal(ed.last().rules[2].value, 'Bookmarks Menu/News');
  assert.equal(ed.byId('c-folder').querySelector('.folder-button').textContent, 'Bookmarks Menu › News');

  const count = ed.changes.length;
  ed.byId('c-folder').querySelector('.folder-button').click();
  dialog = document.querySelector('dialog.folder-picker');
  dialog.querySelector('.folder-name[data-path="Bookmarks Menu/News"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await settle();
  ed.byId('c-folder').querySelector('.folder-button').click();
  document.querySelector('dialog.folder-picker').close('cancel');
  await settle();
  assert.equal(ed.changes.length, count, 'the same folder or a cancel changes nothing');
  ed.unmount();
});

test('dragging a condition onto another moves it after that one', async () => {
  const ed = mount();
  const rust = ed.byId('c-rust');
  const start = drag(handleOf(rust), 'dragstart', { clientX: 5, clientY: 7 });
  assert.equal(start.dataTransfer.data['application/x-rule-condition'], 'c-rust');
  assert.equal(start.dataTransfer.effectAllowed, 'copyMove');
  assert.equal(start.dataTransfer.image[0], rust);
  await settle();
  assert.ok(rust.classList.contains('dndDragging'));

  const folder = ed.byId('c-folder');
  const over = drag(folder, 'dragover');
  assert.equal(over.event.defaultPrevented, true);
  assert.equal(over.dataTransfer.dropEffect, 'move');
  assert.ok(folder.classList.contains('dndOver'));
  assert.equal(drag(folder, 'dragenter', { altKey: true }).dataTransfer.dropEffect, 'copy');
  drag(folder, 'dragleave', { relatedTarget: folder.querySelector('input') });
  assert.ok(folder.classList.contains('dndOver'), 'moving onto a child keeps the mark');
  drag(folder, 'dragleave', { relatedTarget: null });
  assert.ok(!folder.classList.contains('dndOver'));

  drag(folder, 'drop');
  assert.deepEqual(values(ed.last()), [['https'], 'Bookmarks Menu/Dev', 'rust']);
  assert.ok(!ed.box.querySelector('.dndDragging'));
  ed.unmount();
});

test('a condition cannot drop onto itself or the one just before it', () => {
  const ed = mount();
  const folder = ed.byId('c-folder');
  drag(handleOf(folder), 'dragstart');
  const self = drag(folder, 'dragover');
  assert.equal(self.event.defaultPrevented, true, 'the page-wide handler takes it');
  assert.equal(self.dataTransfer.dropEffect, 'none');
  assert.ok(folder.classList.contains('dndDropNotAllowed'));
  drag(folder, 'drop');
  drag(handleOf(ed.byId('inner')), 'dragstart');
  const rust = ed.byId('c-rust');
  drag(rust, 'dragover');
  assert.ok(rust.classList.contains('dndDropNotAllowed'));
  assert.ok(!folder.classList.contains('dndDropNotAllowed'), 'only one target is marked at a time');
  drag(rust, 'drop');
  assert.equal(ed.changes.length, 0);

  drag(handleOf(folder), 'dragstart');
  drag(handleOf(folder), 'dragend');
  assert.ok(!folder.classList.contains('dndDragging'));
  assert.equal(drag(document.body, 'dragover').dataTransfer.dropEffect, '', 'nothing is being dragged');
  drag(ed.byId('c-rust'), 'drop');
  assert.equal(ed.changes.length, 0);
  ed.unmount();
});

test('dropping on a group header puts the item first in that group', () => {
  const ed = mount();
  drag(handleOf(ed.byId('c-folder')), 'dragstart');
  drag(headerOf(ed.byId('inner')), 'dragover');
  assert.ok(headerOf(ed.byId('inner')).classList.contains('dndOver'));
  drag(headerOf(ed.byId('inner')), 'drop');
  assert.deepEqual(values(ed.last()), ['rust', ['Bookmarks Menu/Dev', 'https']]);
  ed.unmount();
});

test('holding Alt before a drag drops a copy', () => {
  const ed = mount();
  key('keydown', 'Alt', 'AltLeft');
  drag(handleOf(ed.byId('c-rust')), 'dragstart');
  drag(ed.byId('c-folder'), 'dragover');
  assert.ok(ed.byId('c-folder').classList.contains('dndCopy'));
  drag(ed.byId('c-folder'), 'drop');
  key('keyup', 'Alt', 'AltLeft');
  assert.deepEqual(values(ed.last()), ['rust', ['https'], 'Bookmarks Menu/Dev', 'rust']);
  ed.unmount();
});

test('holding Ctrl before a drag groups the item with the target', () => {
  const ed = mount();
  key('keydown', 'Control', 'ControlLeft');
  drag(handleOf(ed.byId('c-folder')), 'dragstart');
  const target = ed.byId('c-rust');
  drag(target, 'dragover');
  assert.ok(target.classList.contains('dndGroup'));
  drag(target, 'drop');
  assert.deepEqual(values(ed.last()), [['rust', 'Bookmarks Menu/Dev'], ['https']]);
  assert.equal(ed.last().rules[0].combinator, 'and');

  drag(handleOf(ed.byId('c-rust')), 'dragstart');
  const header = headerOf(ed.byId('inner'));
  drag(header, 'dragover');
  assert.ok(ed.byId('inner').classList.contains('dndGroup'), 'a group is marked as a whole');
  drag(header, 'drop');
  assert.equal(ed.last().rules[1].combinator, 'and');
  assert.equal(ed.last().rules[1].rules.length, 2);

  const count = ed.changes.length;
  drag(handleOf(ed.byId('c-https')), 'dragstart');
  drag(headerOf(ed.byId('top')), 'dragover');
  assert.ok(headerOf(ed.byId('top')).classList.contains('dndDropNotAllowed'), 'nothing groups with the top group');
  drag(handleOf(ed.byId('c-https')), 'dragend');
  window.dispatchEvent(new Event('blur'));
  assert.equal(ed.changes.length, count);
  ed.unmount();
});

test('blur and key-up forget held keys, and Meta drops other keys at the next press', () => {
  const ed = mount();
  key('keydown', 'Alt', 'AltLeft');
  window.dispatchEvent(new Event('blur'));
  document.dispatchEvent(new Event('keydown'));
  document.dispatchEvent(new Event('keyup'));
  key('keydown', 'Meta', 'MetaLeft');
  key('keydown', 'a', 'KeyA');
  key('keydown', 'b', 'KeyB');
  key('keyup', 'Meta', 'MetaLeft');
  key('keyup', 'b', 'KeyB');
  drag(handleOf(ed.byId('c-rust')), 'dragstart');
  drag(ed.byId('c-folder'), 'drop');
  assert.deepEqual(values(ed.last()), [['https'], 'Bookmarks Menu/Dev', 'rust'], 'a plain move');
  ed.unmount();
});

test('a condition dragged into another rule moves there, or is copied with Alt', () => {
  const a = mount();
  const b = mount({ id: 'b-top', combinator: 'and', not: false, rules: [cond('title', 'contains', 'go')] });
  drag(handleOf(a.byId('c-rust')), 'dragstart');
  drag(headerOf(b.byId('b-top')), 'dragover');
  assert.ok(headerOf(b.byId('b-top')).classList.contains('dndOver'));
  drag(headerOf(b.byId('b-top')), 'drop');
  assert.deepEqual(values(b.last()), ['rust', 'go']);
  assert.notEqual(b.last().rules[0].id, 'c-rust', 'the copy in the new rule has a new id');
  assert.deepEqual(values(a.last()), [['https'], 'Bookmarks Menu/Dev']);

  key('keydown', 'Alt', 'AltLeft');
  drag(handleOf(a.byId('inner')), 'dragstart');
  drag(b.byId('c-go'), 'drop');
  key('keyup', 'Alt', 'AltLeft');
  assert.deepEqual(values(b.last()), ['rust', 'go', ['https']]);
  assert.equal(a.changes.length, 1, 'a copy leaves the first rule alone');
  a.unmount();
  b.unmount();
});

test('a condition dragged into another rule with Ctrl is grouped with the target', () => {
  const a = mount();
  const b = mount({ id: 'b-top', combinator: 'or', not: false, rules: [cond('title', 'contains', 'go'), cond('title', 'contains', 'zig')] });
  key('keydown', 'Control', 'ControlLeft');
  drag(handleOf(a.byId('c-rust')), 'dragstart');
  drag(headerOf(b.byId('b-top')), 'dragover');
  assert.ok(headerOf(b.byId('b-top')).classList.contains('dndDropNotAllowed'));
  drag(b.byId('c-zig'), 'drop');
  key('keyup', 'Control', 'ControlLeft');
  assert.deepEqual(values(b.last()), ['go', ['zig', 'rust']]);
  assert.deepEqual(values(a.last()), [['https'], 'Bookmarks Menu/Dev']);
  a.unmount();
  b.unmount();
});

test('taking an editor down mid-drag forgets the dragged item', () => {
  const a = mount();
  const b = mount();
  drag(handleOf(a.byId('c-rust')), 'dragstart');
  a.unmount();
  drag(b.byId('c-folder'), 'drop');
  assert.equal(b.changes.length, 0);
  drag(handleOf(b.byId('c-rust')), 'dragstart');
  a.unmount();
  assert.equal(drag(document.body, 'dragover').dataTransfer.dropEffect, 'none', 'another editor’s drag goes on');
  drag(handleOf(b.byId('c-rust')), 'dragend');
  b.unmount();
});
