import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, settle, uninstallDom } from './browser-env.js';

installBrowser({ page: 'app.html' });
const { Selection } = await import('../src/ui/dom.js');
const c = await import('../src/ui/components.js');

after(uninstallDom);
beforeEach(() => {
  location.hash = '';
  for (const dialog of document.querySelectorAll('dialog')) dialog.remove();
});

// Resolves to the promise's value, or 'pending' when it has not settled within a moment.
const outcome = (promise) => Promise.race([promise, settle(30).then(() => 'pending')]);
const key = (el, k) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};
const buttonNamed = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);

test('a help link opens the current page\'s help section and shows its tip', () => {
  location.hash = '#organize';
  const link = c.helpLink('Sort bookmarks');
  assert.equal(link.getAttribute('href'), '#help:organize');
  assert.equal(link.title, 'Sort bookmarks — select for help');
  assert.equal(link.getAttribute('aria-label'), 'Help: Sort bookmarks');
  assert.equal(link.textContent, '?');
});

test('a help link without a tip or page falls back to plain help on the stats section', () => {
  const link = c.helpLink();
  assert.equal(link.getAttribute('href'), '#help:stats');
  assert.equal(link.title, 'Help');
  assert.equal(link.getAttribute('aria-label'), 'Help');
  assert.equal(c.helpLink('x', 'broken').getAttribute('href'), '#help:broken');
});

test('a view header shows the title, a help link and the actions', () => {
  const header = c.viewHeader('Duplicates', 'Same address twice', c.emptyState('none'), 'text');
  assert.equal(header.querySelector('h1').textContent, 'Duplicates');
  assert.ok(header.querySelector('.help-link'));
  assert.equal(header.querySelector('.row.wrap').textContent, 'nonetext');
  assert.equal(c.emptyState('All clear.').querySelector('p').textContent, 'All clear.');
});

test('checkboxes follow the selection both ways', () => {
  const sel = new Selection();
  sel.set(['a'], true);
  const list = document.createElement('ul');
  const a = c.checkbox(sel, 'a', 'Pick A');
  const b = c.checkbox(sel, 'b');
  list.append(a, b, document.createElement('input'));
  document.body.append(list);
  assert.equal(a.checked, true);
  assert.equal(b.checked, false);
  assert.equal(a.getAttribute('aria-label'), 'Pick A');
  assert.equal(b.getAttribute('aria-label'), 'Select');
  c.bindCheckboxes(list, sel);

  b.checked = true;
  b.dispatchEvent(new Event('change', { bubbles: true }));
  assert.deepEqual(sel.ids, ['a', 'b']);

  list.lastChild.dispatchEvent(new Event('change', { bubbles: true }));
  assert.deepEqual(sel.ids, ['a', 'b']);

  sel.set(['a'], false);
  assert.equal(a.checked, false);
  assert.equal(b.checked, true);
  list.remove();
});

test('a selection bar counts the selection and enables its actions only when something is picked', () => {
  const sel = new Selection();
  const ran = [];
  const bar = c.selectionBar(sel, [
    { label: 'Delete', danger: true, run: (ids) => ran.push(['delete', ids]) },
    { label: 'Move', primary: true, title: 'Move them', run: () => {} },
    { label: 'Export', always: true, run: () => {} },
  ], [c.emptyState('lead')]);
  const [del, move, exp] = bar.querySelectorAll('button');
  assert.equal(bar.querySelector('.count').textContent, '0 selected');
  assert.equal(del.className, 'danger');
  assert.equal(move.className, 'primary');
  assert.equal(move.title, 'Move them');
  assert.equal(exp.className, '');
  assert.deepEqual([del.disabled, move.disabled, exp.disabled], [true, true, false]);
  assert.match(bar.textContent, /lead/);

  sel.set(['x', 'y'], true);
  assert.equal(bar.querySelector('.count').textContent, '2 selected');
  assert.equal(del.disabled, false);
  del.click();
  assert.deepEqual(ran, [['delete', ['x', 'y']]]);
});

test('a paged list shows a page at a time and remembers how far it was opened', () => {
  const items = Array.from({ length: c.PAGE * 2 + 5 }, (_, i) => i);
  const make = (i) => Object.assign(document.createElement('li'), { textContent: String(i) });
  const list = document.createElement('ul');
  const more = c.pagedList('test-list', list, items, make);
  assert.equal(list.children.length, c.PAGE);
  assert.equal(more.hidden, false);
  assert.equal(more.textContent, `Show ${c.PAGE} more (${c.PAGE + 5} not shown)`);
  more.click();
  assert.equal(list.children.length, c.PAGE * 2);
  assert.equal(more.textContent, 'Show 5 more (5 not shown)');
  more.click();
  assert.equal(list.children.length, items.length);
  assert.equal(more.hidden, true);

  const again = document.createElement('ul');
  const more2 = c.pagedList('test-list', again, items, make);
  assert.equal(again.children.length, items.length);
  assert.equal(more2.hidden, true);
});

test('a short paged list shows everything with no more button', () => {
  const list = document.createElement('ul');
  const more = c.pagedList('short', list, [1, 2], (i) => document.createElement('li'));
  assert.equal(list.children.length, 2);
  assert.equal(more.hidden, true);
});

test('pickIds keeps the items with the given ids in their own order', () => {
  assert.deepEqual(c.pickIds([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c', 'a']), [{ id: 'a' }, { id: 'c' }]);
});

test('a select-all button selects everything, then clears it', () => {
  const sel = new Selection();
  sel.set(['a'], true);
  const button = c.selectAllToggle(sel, ['a', 'b']);
  assert.equal(button.textContent, 'Select all');
  button.click();
  assert.deepEqual(sel.ids, ['a', 'b']);
  button.click();
  assert.deepEqual(sel.ids, []);
  assert.equal(c.selectAllToggle(sel, [], 'All rows').textContent, 'All rows');
});

test('marked wraps the given ranges in mark elements and keeps the rest as text', () => {
  assert.deepEqual(c.marked('plain'), ['plain']);
  const parts = c.marked('hello world', [[0, 2], [6, 11]]);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].outerHTML, '<mark>he</mark>');
  assert.equal(parts[1], 'llo ');
  assert.equal(parts[2].textContent, 'world');
  const middle = c.marked('abc', [[1, 2]]);
  assert.equal(middle[0], 'a');
  assert.equal(middle[2], 'c');
});

test('bookmark info shows the name, address, folder and date, with highlights', () => {
  const box = c.bookmarkInfo({ id: 'a', title: 'Alpha', url: 'https://alpha.test/', path: ['Menu', 'Work'], dateAdded: Date.UTC(2024, 0, 2) }, {},
    { meta: [document.createTextNode('extra')], highlight: { title: [[0, 1]], url: [[8, 13]] } });
  const link = box.querySelector('.bm-title a');
  assert.equal(link.getAttribute('href'), 'https://alpha.test/');
  assert.equal(link.textContent, 'Alpha');
  assert.equal(link.querySelector('mark').textContent, 'A');
  assert.equal(box.querySelector('.bm-url mark').textContent, 'alpha');
  assert.match(box.querySelector('.bm-meta').textContent, /Menu › Work/);
  assert.match(box.querySelector('.bm-meta').textContent, /Added .*2024/);
  assert.match(box.querySelector('.bm-meta').textContent, /extra$/);
  assert.ok(buttonNamed(box, 'Edit'));
});

test('bookmark info marks an unnamed bookmark and shows folders as plain names', () => {
  const unnamed = c.bookmarkInfo({ id: 'a', title: '', url: 'https://x.test/' }, {}, { editable: false });
  assert.equal(unnamed.querySelector('a').className, 'untitled');
  assert.equal(unnamed.querySelector('a').textContent, '(no name)');
  assert.equal(unnamed.querySelector('button'), null);
  assert.equal(unnamed.querySelector('.bm-meta').textContent, '(root)');

  const folder = c.bookmarkInfo({ id: 'f', title: '' }, {});
  assert.equal(folder.querySelector('.bm-title span').textContent, '(no name)');
  assert.equal(folder.querySelector('.bm-url'), null);
  assert.equal(c.bookmarkInfo({ id: 'g', title: 'Work' }, {}).querySelector('.bm-title span').textContent, 'Work');
});

test('editing a bookmark saves only what changed through the context', async () => {
  const runs = [];
  const ctx = {
    run: async (fn) => runs.push(await fn()),
    actions: { update: async (changes, label) => ({ changes, label }) },
  };
  const box = c.bookmarkInfo({ id: 'a', title: 'Alpha', url: 'https://alpha.test/' }, ctx);
  document.body.append(box);
  buttonNamed(box, 'Edit').click();
  const [title, url] = box.querySelectorAll('input');
  assert.equal(document.activeElement, title);
  assert.equal(url.value, 'https://alpha.test/');
  title.value = 'Alpha 2';
  url.value = 'https://alpha2.test/';
  box.querySelector('form').requestSubmit();
  await settle();
  assert.deepEqual(runs, [{ changes: [{ id: 'a', title: 'Alpha 2', url: 'https://alpha2.test/' }], label: 'Edited “Alpha 2”' }]);
  box.remove();
});

test('editing an unnamed bookmark labels the change by its old address', async () => {
  const runs = [];
  const ctx = { run: async (fn) => runs.push(await fn()), actions: { update: async (changes, label) => label } };
  const box = c.bookmarkInfo({ id: 'a', url: 'https://alpha.test/' }, ctx);
  buttonNamed(box, 'Edit').click();
  box.querySelectorAll('input')[1].value = 'https://beta.test/';
  box.querySelector('form').requestSubmit();
  await settle();
  assert.deepEqual(runs, ['Edited “https://alpha.test/”']);
});

test('saving an unchanged edit, cancelling or pressing Escape goes back to the plain view', async () => {
  let runs = 0;
  const ctx = { run: async () => runs++, actions: {} };
  const box = c.bookmarkInfo({ id: 'f', title: 'Work' }, ctx);
  buttonNamed(box, 'Edit').click();
  assert.equal(box.querySelectorAll('input').length, 1);
  box.querySelector('form').requestSubmit();
  await settle();
  assert.equal(runs, 0);
  assert.equal(box.querySelector('form'), null);

  buttonNamed(box, 'Edit').click();
  buttonNamed(box, 'Cancel').click();
  assert.equal(box.querySelector('form'), null);

  buttonNamed(box, 'Edit').click();
  key(box, 'a');
  assert.ok(box.querySelector('form'));
  buttonNamed(box, 'Edit')?.click();
  const fresh = c.bookmarkInfo({ id: 'g', title: 'Home' }, ctx);
  buttonNamed(fresh, 'Edit').click();
  key(fresh, 'Escape');
  assert.equal(fresh.querySelector('form'), null);
  assert.ok(buttonNamed(fresh, 'Edit'));
});

test('a row holds a checkbox, the content and the extra actions', () => {
  const sel = new Selection();
  const li = c.row(sel, 'a', c.emptyState('content'), [c.emptyState('act')]);
  assert.equal(li.className, 'item');
  assert.equal(li.querySelector('input').dataset.sel, 'a');
  assert.equal(li.querySelector('.item-actions').textContent, 'act');
});

test('a tag input adds typed keywords on Enter or comma, sorted and without repeats', () => {
  const values = ['beta'];
  const changes = [];
  const box = c.tagInput({ values, onchange: (v) => changes.push(v) });
  document.body.append(box);
  const input = box.querySelector('input');
  assert.equal(input.getAttribute('aria-label'), 'Keywords');
  assert.equal(input.placeholder, '');
  input.value = 'alpha, beta';
  assert.ok(key(input, 'Enter').defaultPrevented);
  assert.deepEqual(values, ['alpha', 'beta']);
  assert.deepEqual(changes, [['alpha', 'beta']]);
  assert.deepEqual([...box.querySelectorAll('.tag-text')].map((b) => b.textContent), ['alpha', 'beta']);
  assert.equal(input.value, '');

  input.value = 'gamma';
  key(input, ',');
  assert.deepEqual(values, ['alpha', 'beta', 'gamma']);

  input.value = 'beta';
  key(input, 'Enter');
  assert.equal(changes.length, 2);
  assert.equal(input.value, '');

  assert.equal(key(input, 'a').defaultPrevented, false);
  box.remove();
});

test('a tag input removes chips with their buttons or Backspace, and puts a clicked chip back for editing', () => {
  const values = ['b', 'a', 'c'];
  const changes = [];
  const box = c.tagInput({ values, onchange: (v) => changes.push(v), placeholder: 'Add words', label: 'Words', mono: true });
  document.body.append(box);
  assert.equal(box.className, 'tag-input mono');
  const input = box.querySelector('input');
  assert.deepEqual([...box.querySelectorAll('.tag-text')].map((b) => b.textContent), ['a', 'b', 'c']);
  assert.deepEqual(values, ['b', 'a', 'c']);

  box.querySelector('[aria-label="Remove “a”"]').click();
  assert.deepEqual(values, ['b', 'c']);
  assert.equal(document.activeElement, input);

  key(input, 'Backspace');
  assert.deepEqual(values, ['b']);

  input.value = 'x';
  key(input, 'Backspace');
  assert.deepEqual(values, ['b']);

  input.value = '';
  box.querySelector('.tag-text').click();
  assert.deepEqual(values, []);
  assert.equal(input.value, 'b');
  assert.equal(input.placeholder, 'Add words');
  assert.equal(changes.length, 3);

  input.value = '';
  key(input, 'Backspace');
  assert.equal(changes.length, 3);
  box.remove();
});

test('a tag input splits pasted lists, and keeps commas when they are not separators', () => {
  const paste = (input, text) => {
    const e = new ClipboardEvent('paste', { clipboardData: new DataTransfer(), cancelable: true });
    e.clipboardData.setData('text', text);
    input.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const values = [];
  const box = c.tagInput({ values, onchange: () => {} });
  const input = box.querySelector('input');
  assert.equal(paste(input, 'one'), false);
  input.value = 'pre';
  assert.ok(paste(input, 'fix,two\nthree'));
  assert.deepEqual(values, ['prefix', 'three', 'two']);
  assert.equal(input.dispatchEvent(new Event('paste', { cancelable: true })), true);

  const words = [];
  const loose = c.tagInput({ values: words, onchange: () => {}, commaSeparates: false });
  const field = loose.querySelector('input');
  assert.equal(paste(field, 'a,b'), false);
  field.value = 'x,y';
  key(field, ',');
  assert.deepEqual(words, []);
  field.value = '';
  assert.ok(paste(field, 'a,b\nc'));
  assert.deepEqual(words, ['a,b', 'c']);
});

test('a tag input keeps what was typed when the field loses focus, and a click on the box focuses the field', () => {
  const values = [];
  const box = c.tagInput({ values, onchange: () => {} });
  document.body.append(box);
  const input = box.querySelector('input');
  input.value = '  ';
  input.dispatchEvent(new Event('blur'));
  assert.deepEqual(values, []);
  input.value = 'kept';
  input.dispatchEvent(new Event('blur'));
  assert.deepEqual(values, ['kept']);

  input.blur();
  box.querySelector('.tag').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.notEqual(document.activeElement, input);
  box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(document.activeElement, input);
  box.remove();
});

const ruleRoot = {
  children: [
    { id: 'menu', title: 'Menu', children: [
      { id: 'work', title: 'Work', children: [{ id: 'deep', title: 'Deep', children: [] }] },
      { id: 'x', title: 'Link', url: 'https://x.test/' },
      { id: 'nt', type: 'folder' },
    ] },
    { id: 'toolbar', children: [] },
    { id: 'other', title: 'Other', children: [] },
  ],
};
const ruleEntries = [
  { id: 'r1', label: 'News sites', folder: 'Menu' },
  { id: 'r2', label: 'Docs', folder: 'Menu/Work/Deep' },
  { id: 'r3', label: 'Locked', folder: 'Menu/Work', disabled: true, reason: 'In use' },
  { id: 'r4', label: 'Future', folder: 'Menu/Missing' },
  { id: 'r5', label: 'Unnamed root rule', folder: '' },
];

test('the rule picker lists rules under their folders, extras first and missing folders last', async () => {
  const answer = c.pickRule(ruleRoot, ruleEntries, { extras: [{ id: '*', label: 'All other rules', folder: '' }], current: 'r2' });
  const dialog = document.querySelector('dialog.folder-picker');
  assert.equal(dialog.querySelector('h2').textContent, 'Choose a rule');
  const tree = dialog.querySelector('.rule-tree-picker');
  const top = [...tree.children];
  assert.equal(top[0].querySelector('.rank-all-icon') !== null, true);
  assert.equal(top[0].textContent, 'All other rules');
  assert.equal(top[1].querySelector('summary').textContent, 'Menu');
  const menuItems = [...top[1].querySelector('ul').children].map((li) => li.querySelector('.rule-choice, summary').textContent);
  assert.deepEqual(menuItems, ['News sites', 'Work']);
  assert.equal(tree.querySelector('[data-id=r3]').disabled, true);
  assert.equal(tree.querySelector('[data-id=r3]').title, 'In use');
  assert.equal(tree.querySelector('[data-id=r2]').title, 'Docs');
  assert.equal(top.at(-1).querySelector('summary').textContent, 'Folders that do not exist yet');
  assert.deepEqual([...top.at(-1).querySelectorAll('.rule-choice')].map((b) => b.dataset.id), ['r4']);
  assert.equal(top[2].querySelector('summary').textContent, '(no name)');
  assert.equal(top[2].querySelector('.rule-choice').dataset.id, 'r5');
  assert.ok(tree.querySelector('[data-id=r2]').classList.contains('selected'));
  assert.equal(dialog.querySelector('button[value=ok]').disabled, false);
  assert.equal(document.activeElement, dialog.querySelector('input[type=search]'));

  tree.querySelector('[data-id=r1]').click();
  assert.ok(tree.querySelector('[data-id=r1]').classList.contains('selected'));
  assert.ok(!tree.querySelector('[data-id=r2]').classList.contains('selected'));
  dialog.querySelector('button[value=ok]').click();
  assert.equal(await outcome(answer), 'r1');
  assert.equal(dialog.isConnected, false);
});

test('the rule picker filters by rule or folder name and says when nothing matches', async () => {
  const answer = c.pickRule(ruleRoot, ruleEntries, { heading: 'Rank', confirm: 'Pick', extras: [{ id: '*', label: 'All other rules' }] });
  const dialog = document.querySelector('dialog.folder-picker');
  const search = dialog.querySelector('input[type=search]');
  const ok = buttonNamed(dialog, 'Pick');
  assert.equal(ok.disabled, true);
  const ids = () => [...dialog.querySelectorAll('.rule-choice')].map((b) => b.dataset.id);

  search.value = 'deep';
  search.dispatchEvent(new Event('input'));
  assert.deepEqual(ids(), ['r2']);
  search.value = 'OTHER';
  search.dispatchEvent(new Event('input'));
  assert.deepEqual(ids(), ['*']);
  search.value = 'nothing here';
  search.dispatchEvent(new Event('input'));
  assert.equal(dialog.querySelector('.rule-tree-picker li.muted').textContent, 'No matching rules.');

  dialog.querySelector('button[value=cancel]').click();
  assert.equal(await outcome(answer), null);
});

test('the rule picker leaves out the missing-folders branch when every folder exists', async () => {
  const answer = c.pickRule(ruleRoot, ruleEntries.filter((e) => e.id !== 'r4'));
  const tree = document.querySelector('dialog.folder-picker .rule-tree-picker');
  assert.doesNotMatch(tree.textContent, /false|do not exist yet/);
  const search = document.querySelector('dialog.folder-picker input[type=search]');
  search.value = 'nothing here';
  search.dispatchEvent(new Event('input'));
  assert.equal(tree.textContent, 'No matching rules.');
  document.querySelector('dialog.folder-picker button[value=cancel]').click();
  assert.equal(await outcome(answer), null);
});

test('double-clicking a rule picks it at once', async () => {
  const answer = c.pickRule(ruleRoot, ruleEntries);
  document.querySelector('.rule-choice[data-id=r4]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  assert.equal(await outcome(answer), 'r4');
});

const folderRoot = {
  children: [
    { id: 'menu', title: 'Menu', children: [
      { id: 'work', title: 'Work', children: [{ id: 'deep', title: 'Deep', children: [] }] },
      { id: 'slash', title: 'A/B', children: [] },
      { id: 'bare', title: 'Bare', type: 'folder' },
      { id: 'x', title: 'Link', url: 'https://x.test/' },
    ] },
    { id: 'toolbar', title: 'Toolbar', children: [] },
    { id: 'other', title: 'Other', children: [{ id: 'u', children: [] }] },
  ],
};

test('the folder picker shows the tree, opens the current folder\'s branch and resolves to the chosen path', async () => {
  const answer = c.pickFolder(folderRoot, 'Menu/Work/Deep');
  const dialog = document.querySelector('dialog.folder-picker');
  assert.equal(dialog.querySelector('h2').textContent, 'Choose a folder');
  const named = (path) => dialog.querySelector(`.folder-name[data-path="${path}"]`);
  assert.ok(named('Menu/Work/Deep').classList.contains('selected'));
  assert.equal(named('Menu/Work').closest('details').open, true);
  assert.equal(dialog.querySelector('.picked').textContent, 'Move to: Menu › Work › Deep');
  const slash = [...dialog.querySelectorAll('.folder-name')].find((b) => b.textContent === 'A/B');
  assert.equal(slash.disabled, true);
  assert.match(slash.title, /cannot be used/);
  assert.equal(named('Menu/Work').title, 'Menu › Work');
  assert.ok([...dialog.querySelectorAll('.folder-name')].some((b) => b.textContent === '(no name)'));

  named('Toolbar').click();
  assert.equal(dialog.querySelector('.picked').textContent, 'Move to: Toolbar');
  const newName = dialog.querySelector('input[aria-label="New subfolder name"]');
  newName.value = ' New/Sub ';
  newName.dispatchEvent(new Event('input'));
  assert.equal(dialog.querySelector('.picked').textContent, 'Create and move to: Toolbar › NewSub');
  dialog.querySelector('button[value=ok]').click();
  assert.equal(await outcome(answer), 'Toolbar/NewSub');
  assert.equal(dialog.isConnected, false);
});

test('the folder picker keeps branches away from the current folder closed', async () => {
  const answer = c.pickFolder(folderRoot, 'Toolbar');
  const dialog = document.querySelector('dialog.folder-picker');
  assert.equal(dialog.querySelector('.folder-name[data-path="Menu"]').closest('details').open, true);
  assert.equal(dialog.querySelector('.folder-name[data-path="Menu/Work"]').closest('details').open, false);
  dialog.querySelector('button[value=cancel]').click();
  assert.equal(await outcome(answer), null);
});

test('the folder picker starts with nothing picked, and can leave out folder creation', async () => {
  const answer = c.pickFolder(folderRoot, '', { heading: 'Where?', verb: 'Copy to', allowCreate: false });
  const dialog = document.querySelector('dialog.folder-picker');
  assert.equal(dialog.querySelector('h2').textContent, 'Where?');
  assert.equal(dialog.querySelector('input[aria-label="New subfolder name"]'), null);
  assert.equal(dialog.querySelector('.picked').textContent, 'Pick a folder.');
  assert.equal(dialog.querySelector('button[value=ok]').disabled, true);
  assert.equal(dialog.querySelector('.folder-name[data-path="Menu/Work"]').closest('details').open, false);
  dialog.querySelector('.folder-name[data-path="Menu"]').click();
  assert.equal(dialog.querySelector('.picked').textContent, 'Copy to: Menu');
  dialog.querySelector('button[value=cancel]').click();
  assert.equal(await outcome(answer), null);
});

test('the folder picker shows a top-level folder without a title', async () => {
  const answer = c.pickFolder({ children: [{ id: 'blank', children: [{ id: 'kid', title: 'Kid', children: [] }] }] });
  const dialog = document.querySelector('dialog.folder-picker');
  assert.equal(dialog.querySelector('.folder-name[data-path="/Kid"]').textContent, 'Kid');
  dialog.querySelector('button[value=cancel]').click();
  assert.equal(await outcome(answer), null);
});

test('searching the folder picker lists matching folders as full paths', async () => {
  const answer = c.pickFolder(folderRoot);
  const dialog = document.querySelector('dialog.folder-picker');
  const search = dialog.querySelector('input[type=search]');
  search.value = ' DE ';
  search.dispatchEvent(new Event('input'));
  const hits = [...dialog.querySelectorAll('.folder-name')];
  assert.deepEqual(hits.map((b) => b.dataset.path), ['Menu/Work/Deep']);
  assert.equal(hits[0].textContent, 'Menu › Work › Deep');
  hits[0].click();
  assert.ok(hits[0].classList.contains('selected'));

  search.value = 'b';
  search.dispatchEvent(new Event('input'));
  assert.deepEqual([...dialog.querySelectorAll('.folder-name')].map((b) => b.dataset.path), ['Menu/Bare', 'Toolbar']);

  search.value = 'zzz';
  search.dispatchEvent(new Event('input'));
  assert.equal(dialog.querySelector('.folder-tree').textContent, 'No matching folders.');

  search.value = 'toolbar';
  search.dispatchEvent(new Event('input'));
  dialog.querySelector('.folder-name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  assert.equal(await outcome(answer), 'Toolbar');
});

test('double-clicking a folder in the tree picks it at once', async () => {
  const answer = c.pickFolder(folderRoot);
  document.querySelector('.folder-name[data-path="Menu/Work"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  assert.equal(await outcome(answer), 'Menu/Work');
});

test('an action menu runs the chosen item, draws dividers and marks dangerous items', () => {
  const ran = [];
  const wrap = c.actionMenu([
    { label: 'Rename', title: 'Rename it', run: () => ran.push('rename') },
    null,
    { label: 'Delete', danger: true, run: () => ran.push('delete') },
    { label: 'Off', disabled: true, run: () => {} },
  ], 'Folder actions');
  document.body.append(wrap);
  const button = wrap.querySelector('.menu-button');
  const menu = wrap.querySelector('.action-menu');
  let toggled = 0;
  let hidden = 0;
  menu.togglePopover = () => toggled++;
  menu.hidePopover = () => hidden++;
  assert.equal(button.getAttribute('aria-label'), 'Folder actions');
  assert.equal(menu.querySelectorAll('hr').length, 1);
  const items = [...menu.querySelectorAll('button')];
  assert.equal(items[0].title, 'Rename it');
  assert.equal(items[1].className, 'danger-text');
  assert.equal(items[2].disabled, true);
  button.click();
  assert.equal(toggled, 1);
  items[1].click();
  assert.equal(hidden, 1);
  assert.deepEqual(ran, ['delete']);
  wrap.remove();
});

test('an opened action menu sits under its button, focuses its first item and moves focus with the arrows', () => {
  const wrap = c.actionMenu([{ label: 'A', run() {} }, { label: 'B', run() {} }, { label: 'C', disabled: true, run() {} }]);
  document.body.append(wrap);
  const button = wrap.querySelector('.menu-button');
  const menu = wrap.querySelector('.action-menu');
  const toggle = (newState) => menu.dispatchEvent(Object.assign(new Event('toggle'), { newState }));
  assert.equal(button.getAttribute('aria-label'), 'Actions');
  button.getBoundingClientRect = () => ({ top: 100, bottom: 120, left: 300, right: 340 });
  toggle('open');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(menu.style.top, '124px');
  assert.equal(menu.style.left, '340px');
  assert.equal(document.activeElement.textContent, 'A');

  key(menu, 'ArrowDown');
  assert.equal(document.activeElement.textContent, 'B');
  key(menu, 'ArrowDown');
  assert.equal(document.activeElement.textContent, 'A');
  key(menu, 'ArrowUp');
  assert.equal(document.activeElement.textContent, 'B');
  assert.equal(key(menu, 'Enter').defaultPrevented, false);

  toggle('closed');
  assert.equal(button.getAttribute('aria-expanded'), 'false');

  button.getBoundingClientRect = () => ({ top: 790, bottom: 800, left: 0, right: 4 });
  Object.defineProperty(menu, 'offsetHeight', { value: 100, configurable: true });
  toggle('open');
  assert.equal(menu.style.top, '686px');
  assert.equal(menu.style.left, '8px');
  wrap.remove();
});
