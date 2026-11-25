import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, settle, uninstallDom } from './browser-env.js';
import { fakeFetch } from './fake-fetch.js';

const tree = [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'a', title: 'Rust book', url: 'https://doc.rust-lang.org/book' },
    { id: 'b', title: 'Rust news', url: 'https://blog.rust-lang.org/news' },
    { id: 'c', title: 'Cooking', url: 'https://food.test/' },
    { id: 'dev', title: 'Dev', children: [
      { id: 'rustdir', title: 'Rust', children: [] },
      { id: 'd', title: 'Go tour', url: 'https://go.dev/tour' },
    ] },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [
    { id: 'e', title: 'Old rust tips', url: 'https://tips.test/' },
  ] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

const cond = (id, field, operator, value) => ({ id, field, operator, value, caseSensitive: false, wholeWords: false });
const move = (id, path, folderId = '') => ({ id, type: 'move', folderId, path });
const rule = (id, name, conditions, actions, extra = {}) => ({
  id, name, enabled: true, autoRun: false, query: { id: `${id}-q`, combinator: 'or', not: false, rules: conditions }, actions, createdAt: 1, ...extra,
});
const rustRule = (extra) => rule('r1', 'Rust', [cond('k1', 'title', 'contains', 'rust')], [move('m1', 'Bookmarks Menu/Dev/Rust', 'rustdir')], extra);
const goRule = (extra) => rule('r2', 'Go', [cond('k2', 'title', 'contains', 'go')], [move('m2', 'Bookmarks Menu/Dev')], extra);

const browser = installBrowser({ page: 'app.html', tree });
browser.storage.local.data.settings = { organize: { rules: [rustRule(), goRule()] } };
location.hash = '#rules';
await import('../src/ui/app.js');
await settle(20);

after(uninstallDom);

const view = () => document.querySelector('#main section.rules-page');
const $ = (sel) => view().querySelector(sel);
const $$ = (sel) => [...view().querySelectorAll(sel)];
const card = (id) => $(`[data-rule="${id}"]`);
const byText = (text, scope = view()) => [...scope.querySelectorAll('button')].find((b) => b.textContent === text);
const toasts = () => [...document.querySelectorAll('#toasts .toast')].map((t) => t.firstChild.textContent);
const saved = () => browser.storage.local.data.settings.organize;
const previewTitle = () => $$('h2').map((h) => h.textContent).find((t) => t.startsWith('Preview'));
const ruleOrder = () => $$('.rule-card').map((c) => c.dataset.rule);
const node = async (id) => (await browser.bookmarks.get(id))[0];
// A pending refresh from storage or bookmark events runs within half a second; waiting it out keeps the page still.
const quiet = () => settle(600);

// Saves rules straight into storage and reloads the page from them.
async function reset(organize, { open = [] } = {}) {
  // A rule menu left open by a test would hold back the page's refreshes.
  document.querySelector('dialog.menu')?.close();
  browser.storage.local.data.settings = { organize };
  byText('Discard changes').click();
  document.querySelector('[data-action=reload]').click();
  await settle(20);
  for (const id of open) if (card(id)?.querySelector('.rule-body').hidden) card(id).querySelector('.rule-toggle').click();
}

function setValue(el, value, type = 'change') {
  el.value = value;
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function setChecked(el, checked) {
  el.checked = checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function lastDialog(sel) {
  await settle();
  return [...document.querySelectorAll(`dialog${sel}`)].at(-1);
}

async function answer(sel, value = 'ok', text) {
  const dialog = await lastDialog(sel);
  if (text !== undefined) dialog.querySelector('input[type=text]').value = text;
  dialog.close(value);
  await settle(20);
  return dialog;
}

async function pick(attr, value) {
  const dialog = await lastDialog('.folder-picker');
  dialog.querySelector(`[${attr}="${value}"]`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await settle(20);
  return dialog;
}

// Opens a rule's ☰ menu and returns the item with this label; clicking the item closes the menu and runs it.
function menuItem(ruleId, label) {
  document.querySelector('dialog.menu')?.close();
  card(ruleId).querySelector('.menu-button').click();
  return [...document.querySelector('dialog.menu').querySelectorAll('button')].find((b) => b.firstChild.textContent === label);
}

function drag(el, type, extra = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = { data: {}, setData(k, v) { this.data[k] = v; }, setDragImage(...args) { this.image = args; }, effectAllowed: '', dropEffect: '' };
  Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
  for (const [k, v] of Object.entries(extra)) Object.defineProperty(e, k, { value: v });
  el.dispatchEvent(e);
  return { event: e, dataTransfer };
}

const actionRows = (id) => [...card(id).querySelectorAll('.action-row')];

// ====
// The list and the preview
// ====

test('the page lists the rules in the order they run and previews what they would do', () => {
  assert.equal(document.title, 'Rules — Ultimate Bookmark Manager');
  assert.deepEqual(ruleOrder(), ['r1', 'r2']);
  assert.deepEqual($$('.rule-number').map((n) => n.textContent), ['1.', '2.']);
  assert.equal(card('r1').querySelector('.rule-badge').textContent, '3 to change');
  assert.equal(card('r2').querySelector('.rule-badge').textContent, '0 to change');
  assert.equal(card('r1').querySelector('.rule-name').title, 'title contains “rust”');
  assert.equal(card('r1').querySelector('.rule-body').hidden, true, 'saved rules start closed');
  assert.equal(previewTitle(), 'Preview: 3 bookmark(s) to change');
  assert.equal($('.group-title > span').textContent, 'Rust — 3');
  assert.equal($('.rule-steps li').textContent, 'Rust: Move to “Bookmarks Menu › Dev › Rust”');
  assert.equal(byText('Apply selected').disabled, false);
  assert.equal($('.unmatched summary h2').textContent, 'Not matched by any rule: 1 bookmark(s)');
  assert.equal(document.querySelector('#nav a.active .badge').textContent, '3');
});

test('a preview group closes and opens from its heading, and stays closed when the page redraws', async () => {
  const toggle = () => $('.group-title .rule-toggle');
  const body = () => $('.group-title').nextElementSibling;
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');

  toggle().click();
  assert.equal(body().hidden, true);
  assert.equal(toggle().getAttribute('aria-label'), 'Expand group');

  location.hash = '#stats';
  await settle(20);
  location.hash = '#rules';
  await settle(20);
  assert.equal(body().hidden, true, 'still closed after a redraw');

  toggle().click();
  assert.equal(body().hidden, false);
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');
});

test('opening a rule shows its editor and what it matches', () => {
  card('r1').querySelector('.rule-name').click();
  const body = card('r1').querySelector('.rule-body');
  assert.equal(body.hidden, false);
  assert.equal(card('r1').querySelector('.rule-toggle').getAttribute('aria-expanded'), 'true');
  assert.ok(card('r1').classList.contains('open'));
  assert.equal(body.querySelector('.query-box .keyword').value, 'rust');
  assert.equal(actionRows('r1')[0].querySelector('.action-type').value, 'move');
  assert.equal(actionRows('r1')[0].querySelector('.folder-button').textContent, 'Bookmarks Menu › Dev › Rust');
  assert.equal(body.querySelector('.rule-info').textContent, 'Matches 3 bookmark(s) and would change 3.');
  card('r1').querySelector('.rule-toggle').click();
  assert.equal(body.hidden, true);
  assert.equal(card('r1').querySelector('.rule-toggle').getAttribute('aria-label'), 'Edit rule');
  card('r1').querySelector('.rule-toggle').click();
  assert.equal(body.childElementCount, 5, 'the editor is built only once');
});

test('editing a keyword marks unsaved changes and refreshes the preview after a pause', async () => {
  setValue(card('r1').querySelector('.keyword'), 'rust book', 'input');
  assert.equal($('.view-header .muted.small').textContent, 'Unsaved changes');
  assert.equal(previewTitle(), 'Preview: 3 bookmark(s) to change');
  await settle(350);
  assert.equal(previewTitle(), 'Preview: 1 bookmark(s) to change');
  assert.equal(card('r1').querySelector('.rule-badge').textContent, '1 to change');
  byText('Discard changes').click();
  assert.equal(previewTitle(), 'Preview: 3 bookmark(s) to change');
  assert.equal($('.view-header .muted.small').textContent, '');
});

test('saving writes the rules, the new-bookmarks switch and each move’s current folder path', async () => {
  await reset({ rules: [rustRule({ actions: [move('m1', 'Bookmarks Menu/Dev/Old name', 'rustdir')] }), goRule()] }, { open: ['r1'] });
  assert.equal(actionRows('r1')[0].querySelector('.folder-button').textContent, 'Bookmarks Menu › Dev › Rust', 'the folder is shown by id');
  setChecked(card('r1').querySelector('[aria-label="Run on new bookmarks"]'), true);
  assert.ok(card('r1').querySelector('.score-chip'), 'the rule is marked as running on new bookmarks');
  byText('Save rules').click();
  await settle(20);
  assert.equal(saved().rules[0].autoRun, true);
  assert.equal(saved().rules[0].actions[0].path, 'Bookmarks Menu/Dev/Rust');
  assert.ok(toasts().includes('Rules saved.'));
  assert.equal($('.view-header .muted.small').textContent, '');
  await quiet();
});

test('an unticked change stays unticked, and applying changes only the ticked bookmarks', async () => {
  await reset({ rules: [rustRule(), goRule()] });
  const box = (id) => $(`input[data-sel="${id}"]`);
  setChecked(box('e'), false);
  document.querySelector('[data-action=reload]').click();
  await settle(20);
  assert.equal(box('e').checked, false, 'a refresh keeps it unticked');

  byText('Apply selected').click();
  let dialog = await answer('.confirm', 'cancel');
  assert.equal(dialog.querySelector('p').textContent, 'Apply the rules to 2 bookmark(s)? Missing folders are created. You can undo this from the history.');
  assert.equal((await node('a')).parentId, 'menu________', 'a cancel changes nothing');

  card('r1').querySelector('.rule-toggle').click();
  setChecked(card('r1').querySelector('[aria-label="Run on new bookmarks"]'), true);
  byText('Apply selected').click();
  dialog = await answer('.confirm', 'ok');
  assert.ok(dialog.querySelector('p').textContent.endsWith('Your rule changes will be saved too.'));
  await settle(20);
  assert.equal((await node('a')).parentId, 'rustdir');
  assert.equal((await node('b')).parentId, 'rustdir');
  assert.equal((await node('e')).parentId, 'unfiled_____');
  assert.equal(saved().rules[0].autoRun, true, 'the unsaved switch was saved');
  assert.ok(toasts().includes('Applied the rules to 2 bookmark(s).'));
  assert.equal(previewTitle(), 'Preview: 1 bookmark(s) to change');
  assert.equal(byText('Apply selected').disabled, true);

  byText('Select all').click();
  assert.equal(box('e').checked, true);
  byText('Select group').click();
  assert.equal(box('e').checked, false);
  byText('Select group').click();
  byText('Apply selected').click();
  await answer('.confirm', 'ok');
  await settle(20);
  assert.equal((await node('e')).parentId, 'rustdir');
  assert.equal($('.empty-state p').textContent, 'Nothing to do: every matching bookmark is already as the rules would leave it.');
  await quiet();
  for (const id of ['a', 'b']) await browser.bookmarks.move(id, { parentId: 'menu________' });
  await browser.bookmarks.move('e', { parentId: 'unfiled_____' });
  await quiet();
});

// ====
// Actions
// ====

test('actions can be added, changed, reordered and removed, and the preview shows what each bookmark becomes', async () => {
  await reset({ rules: [rule('t', 'Tips', [cond('k', 'title', 'contains', 'tips')], [move('m', 'Bookmarks Menu/Dev/Rust', 'rustdir')])] }, { open: ['t'] });
  byText('+ Action', card('t')).click();
  assert.equal(actionRows('t').length, 2);
  assert.equal(actionRows('t')[1].querySelector('.folder-button').textContent, 'Choose a folder…');
  assert.match(card('t').querySelector('.rule-info').textContent, /Choose the folder to move to\./);
  assert.equal(card('t').querySelector('.rule-badge').textContent, 'Needs attention');

  setValue(actionRows('t')[1].querySelector('.action-type'), 'replace');
  const [find, replace] = actionRows('t')[1].querySelectorAll('input[type=text]');
  setValue(find, 'Old', 'input');
  setValue(replace, 'New', 'input');
  setValue(actionRows('t')[1].querySelector('select[aria-label="Look in"]'), 'title');
  setChecked(actionRows('t')[1].querySelector('.check-line input'), true);
  await settle(350);
  const row = $('input[data-sel="e"]').closest('.item');
  assert.deepEqual([...row.querySelectorAll('.rule-steps li')].map((li) => li.textContent),
    ['Tips: Move to “Bookmarks Menu › Dev › Rust”', 'Tips: Replace “Old” with “New” in names']);
  assert.equal(row.querySelector('.replaced .bm-title').textContent, 'New rust tips');
  assert.equal(row.querySelector('.matched').textContent, 'Matched “tips” in title');

  byText('↑', actionRows('t')[1]).click();
  assert.equal(actionRows('t')[0].querySelector('.action-type').value, 'replace');
  assert.equal(byText('↑', actionRows('t')[0]).disabled, true);
  byText('↓', actionRows('t')[0]).click();
  assert.equal(actionRows('t')[0].querySelector('.action-type').value, 'move');
  assert.equal(byText('↓', actionRows('t')[1]).disabled, true);

  setValue(actionRows('t')[1].querySelector('.action-type'), 'ignore');
  assert.equal(actionRows('t')[1].querySelector('.action-settings').textContent, 'Every check, and these rules, skip it from then on.');
  byText('×', actionRows('t')[0]).click();
  byText('×', actionRows('t')[0]).click();
  assert.equal(actionRows('t').length, 0);
  assert.match(card('t').querySelector('.rule-info').textContent, /Add an action\./);
});

test('a move action’s folder is picked from the tree and remembered by id', async () => {
  await reset({ rules: [rule('t', 'Tips', [cond('k', 'title', 'contains', 'tips')], [move('m', '')])] }, { open: ['t'] });
  actionRows('t')[0].querySelector('.folder-button').click();
  await answer('.folder-picker', 'cancel');
  assert.equal(actionRows('t')[0].querySelector('.folder-button').textContent, 'Choose a folder…');
  actionRows('t')[0].querySelector('.folder-button').click();
  await pick('data-path', 'Bookmarks Menu/Dev');
  assert.equal(actionRows('t')[0].querySelector('.folder-button').textContent, 'Bookmarks Menu › Dev');
  byText('Save rules').click();
  await settle(20);
  assert.deepEqual({ ...saved().rules[0].actions[0] }, { id: 'm', type: 'move', folderId: 'dev', path: 'Bookmarks Menu/Dev' });
  await quiet();
});

test('deleting, ignoring and editing are applied together, with deletions named in the question', async () => {
  const spam = rule('s', 'Spam', [cond('k', 'title', 'contains', 'cooking')], [{ id: 'x', type: 'delete' }]);
  const tidy = rule('t', 'Tidy', [cond('k', 'title', 'contains', 'tips')], [{ id: 'y', type: 'replace', find: 'Old ', replace: '', field: 'title', caseSensitive: false, regex: false }, { id: 'z', type: 'ignore' }]);
  await reset({ rules: [spam, tidy] });
  assert.equal($('input[data-sel="c"]').closest('.item').querySelector('.rule-steps li').className, 'error');
  byText('Apply selected').click();
  const dialog = await answer('.confirm', 'ok');
  assert.match(dialog.querySelector('p').textContent, /^Apply the rules to 2 bookmark\(s\)\? 1 will be deleted\./);
  await settle(20);
  await assert.rejects(node('c'));
  assert.equal((await node('e')).title, 'rust tips');
  assert.deepEqual(browser.storage.local.data.whitelist.e, { title: 'rust tips', url: 'https://tips.test/' });
  await quiet();
  delete browser.storage.local.data.whitelist;
  await browser.bookmarks.update('e', { title: 'Old rust tips' });
  await browser.bookmarks.create({ parentId: 'menu________', title: 'Cooking', url: 'https://food.test/' });
  await quiet();
});

test('a change that would leave an invalid URL is shown but cannot be ticked', async () => {
  await reset({ rules: [rule('u', 'Break', [cond('k', 'title', 'contains', 'tips')], [{ id: 'y', type: 'replace', find: 'https://', replace: '', field: 'url', caseSensitive: false, regex: false }])] });
  const row = $$('.item').find((li) => li.textContent.includes('Old rust tips'));
  assert.equal(row.querySelector('input[type=checkbox]').disabled, true);
  assert.equal(row.querySelector('.warn').textContent, 'The new URL is not a valid address');
  assert.equal($('p.warn').textContent, '1 bookmark(s) would get a URL that is not a valid address and are left out.');
});

test('page titles and redirects already found are used, and missing ones are read when applied', async () => {
  const { fetch } = globalThis;
  globalThis.fetch = fakeFetch({ 'https://tips.test/': { html: '<title>Tips and tricks</title>', finalUrl: 'https://tips.test/new' } });
  browser.storage.local.data.linkResults = { time: 1, results: [], titles: { a: { url: 'https://doc.rust-lang.org/book', title: 'The Rust Book' } } };
  const named = rule('n', 'Name', [cond('k', 'title', 'contains', 'rust')], [{ id: 'p', type: 'pageTitle' }, { id: 'q', type: 'redirect' }]);
  try {
    await reset({ rules: [named] }, { open: ['n'] });
    assert.equal(actionRows('n')[0].querySelector('.action-settings').textContent, 'Uses the title the last link check found, or reads the page when applied.');
    const rowOf = (id) => $(`input[data-sel="${id}"]`).closest('.item');
    assert.equal(rowOf('a').querySelector('.replaced .bm-title').textContent, 'The Rust Book');
    assert.ok(rowOf('a').querySelector('.rule-steps li.muted'), 'its redirect is still to be read');
    assert.equal(rowOf('e').querySelector('.replaced'), null, 'nothing is known yet');
    setChecked($('input[data-sel="a"]'), false);
    setChecked($('input[data-sel="b"]'), false);
    byText('Apply selected').click();
    const dialog = await answer('.confirm', 'ok');
    assert.match(dialog.querySelector('p').textContent, /1 page\(s\) are read first\./);
    await settle(50);
    const tips = await node('e');
    assert.deepEqual([tips.title, tips.url], ['Tips and tricks', 'https://tips.test/new']);
    assert.ok(browser.calls.some(([name, props]) => name === 'permissions.request' && props.origins?.[0] === '<all_urls>'));
  } finally {
    globalThis.fetch = fetch;
    delete browser.storage.local.data.linkResults;
  }
  await quiet();
  await browser.bookmarks.update('e', { title: 'Old rust tips', url: 'https://tips.test/' });
  await quiet();
});

test('without permission to read pages, those steps are skipped and the rest still applied', async () => {
  const request = browser.permissions.request;
  browser.permissions.request = async () => false;
  const named = rule('n', 'Name', [cond('k', 'title', 'contains', 'tips')], [{ id: 'p', type: 'pageTitle' }, { id: 'i', type: 'ignore' }]);
  try {
    await reset({ rules: [named] });
    byText('Apply selected').click();
    await answer('.confirm', 'ok');
    await settle(50);
    assert.ok(toasts().includes('Reading pages needs permission to access websites, so those steps are skipped.'));
    assert.equal((await node('e')).title, 'Old rust tips');
    assert.ok(browser.storage.local.data.whitelist.e);
  } finally {
    browser.permissions.request = request;
  }
  await quiet();
  delete browser.storage.local.data.whitelist;
  await quiet();
});

// ====
// Editing the list
// ====

test('the bookmarks no rule matches are listed by folder once opened', async () => {
  await reset({ rules: [rustRule(), goRule()] });
  const details = $('details.unmatched');
  assert.equal(details.querySelector('.groups').childElementCount, 0, 'rows wait until opened');
  details.open = true;
  details.dispatchEvent(new Event('toggle'));
  assert.equal(details.querySelector('.group-title').textContent, 'Bookmarks Menu — 1');
  assert.equal(details.querySelector('.bm-title').textContent, 'Cooking');
  document.querySelector('[data-action=reload]').click();
  await settle(20);
  assert.equal($('details.unmatched').open, true, 'it stays open after a refresh');
  $('details.unmatched').open = false;
  $('details.unmatched').dispatchEvent(new Event('toggle'));
});

test('the rule menu renames, duplicates, moves up and down and deletes a rule', async () => {
  await reset({ rules: [rustRule(), goRule()] });
  menuItem('r1', 'Rename…').click();
  await answer('.prompt', 'ok', 'Rusty');
  assert.equal(card('r1').querySelector('.rule-name').textContent, 'Rusty');
  menuItem('r1', 'Rename…').click();
  await answer('.prompt', 'cancel');
  assert.equal(card('r1').querySelector('.rule-name').textContent, 'Rusty');

  menuItem('r1', 'Duplicate').click();
  const copy = card('r1').nextElementSibling;
  assert.equal(copy.querySelector('.rule-name').textContent, 'Rusty (copy)');
  assert.equal(copy.querySelector('.rule-body').hidden, false, 'a copy opens for editing');

  assert.equal(menuItem('r1', 'Move up').disabled, true);
  document.querySelector('dialog.menu').close();
  menuItem('r1', 'Move down').click();
  assert.deepEqual(ruleOrder(), [copy.dataset.rule, 'r1', 'r2']);
  menuItem('r1', 'Move up').click();
  assert.deepEqual(ruleOrder(), ['r1', copy.dataset.rule, 'r2']);
  assert.equal(menuItem('r2', 'Move down').disabled, true);
  document.querySelector('dialog.menu').close();

  menuItem('r1', 'Delete').click();
  assert.equal(card('r1'), null);
  byText('Save rules').click();
  await settle(20);
  assert.deepEqual(saved().rules.map((r) => r.name), ['Rusty (copy)', 'Go']);
  await quiet();
});

test('merging a rule into another joins their conditions after a confirmation', async () => {
  await reset({ rules: [rustRule(), goRule()] });
  menuItem('r1', 'Merge…').click();
  let dialog = await lastDialog('.folder-picker');
  assert.equal(dialog.querySelector('h2').textContent, 'Merge into “Rust”');
  assert.equal(dialog.querySelector('[data-id=r2]').title, 'title contains “go”');
  await answer('.folder-picker', 'cancel');
  assert.ok(card('r2'));

  menuItem('r1', 'Merge…').click();
  await pick('data-id', 'r2');
  dialog = await answer('.confirm', 'cancel');
  assert.equal(dialog.querySelector('p').textContent, 'Merge “Go” into “Rust”? This rule will match whatever either of them matched and keep its own actions, and “Go” is removed.');
  assert.ok(card('r2'));

  menuItem('r1', 'Merge…').click();
  await pick('data-id', 'r2');
  await answer('.confirm', 'ok');
  assert.equal(card('r2'), null);
  assert.deepEqual([...card('r1').querySelectorAll('.keyword')].map((k) => k.value), ['rust', 'go']);
  assert.equal(card('r1').querySelector('.rule-body').hidden, false);
  assert.equal(menuItem('r1', 'Merge…').disabled, true, 'with one rule left there is nothing to merge');
  document.querySelector('dialog.menu').close();
});

test('moving a condition to a new rule adds a rule with the same actions just below', async () => {
  await reset({ rules: [rule('r1', 'Rust', [cond('k1', 'title', 'contains', 'rust'), cond('k3', 'title', 'contains', 'cargo')], [move('m1', 'Bookmarks Menu/Dev/Rust', 'rustdir')]), goRule()] }, { open: ['r1'] });
  card('r1').querySelector('[data-rule-id="k3"] [aria-label="Move to a new rule"]').click();
  await settle(20);
  const part = card('r1').nextElementSibling;
  assert.equal(part.querySelector('.rule-name').textContent, 'Rust (part)');
  assert.equal(part.querySelector('.keyword').value, 'cargo');
  assert.equal(part.querySelector('.folder-button').textContent, 'Bookmarks Menu › Dev › Rust');
  assert.deepEqual([...card('r1').querySelectorAll('.keyword')].map((k) => k.value), ['rust']);
});

test('switching a rule off greys it out and stops it changing anything', async () => {
  await reset({ rules: [rustRule(), goRule()] }, { open: ['r1'] });
  setChecked(card('r1').querySelector('[aria-label="Enabled"]'), false);
  assert.ok(card('r1').classList.contains('disabled'));
  assert.equal(card('r1').querySelector('.rule-badge').textContent, 'Off');
  await settle(350);
  assert.equal(previewTitle(), 'Preview');
  assert.equal($('.empty-state p').textContent, 'Nothing to do: every matching bookmark is already as the rules would leave it.');
});

test('a rule with problems is flagged with each one', async () => {
  await reset({ rules: [rule('bad', '', [cond('k', 'title', 'matchesRegex', '(')], [])] }, { open: ['bad'] });
  assert.equal(card('bad').querySelector('.rule-badge').textContent, 'Needs attention');
  assert.deepEqual([...card('bad').querySelectorAll('.rule-info .error')].map((p) => p.textContent), ['Add an action.', 'Invalid regex “(”: Invalid regular expression: /(/: Unterminated group']);
});

test('the rule search and expand or collapse all filter and open the list', async () => {
  await reset({ rules: [rustRule(), goRule()] });
  const search = $('input[type=search]');
  setValue(search, 'go', 'input');
  assert.deepEqual(ruleOrder(), ['r2']);
  setValue(search, 'contains “rust”', 'input');
  assert.deepEqual(ruleOrder(), ['r1'], 'conditions are searched too');
  setValue(search, 'nothing like it', 'input');
  assert.equal($('.rule-list-box .empty-state p').textContent, 'No rules match.');
  setValue(search, '', 'input');
  byText('Expand all').click();
  assert.ok($$('.rule-body').every((b) => !b.hidden));
  byText('Collapse all').click();
  assert.ok($$('.rule-body').every((b) => b.hidden));
});

test('“+ Rule” adds an open rule at the end that needs a condition and a folder', async () => {
  await reset({ rules: [rustRule()] });
  byText('+ Rule').click();
  const added = $$('.rule-card').at(-1);
  assert.equal(added.querySelector('.rule-body').hidden, false);
  assert.equal(added.querySelector('.rule-name').textContent, 'Unnamed rule');
  assert.deepEqual([...added.querySelectorAll('.rule-info .error')].map((p) => p.textContent), ['Add a condition; a rule without one matches nothing.', 'Choose the folder to move to.']);
});

test('a rule dragged above or below another changes the order rules run in', async () => {
  const third = rule('r3', 'Tips', [cond('k3', 'title', 'contains', 'tips')], [{ id: 'i', type: 'ignore' }]);
  await reset({ rules: [rustRule(), goRule(), third] });
  // Each card is forty pixels tall from the top, so the upper half drops before it and the lower half after; cards are rebuilt on every drop.
  const sized = () => {
    for (const id of ['r1', 'r2', 'r3']) card(id).getBoundingClientRect = () => ({ top: 0, height: 40 });
  };
  sized();

  const start = drag(card('r1').querySelector('.rule-drag'), 'dragstart');
  assert.equal(start.dataTransfer.data['application/x-bookmark-rule'], 'r1');
  assert.equal(start.dataTransfer.image[0], card('r1'));
  const self = drag(card('r1'), 'dragover', { clientY: 30 });
  assert.equal(self.event.defaultPrevented, false, 'a rule cannot drop on itself');
  const over = drag(card('r3'), 'dragover', { clientY: 30 });
  assert.equal(over.event.defaultPrevented, true);
  assert.ok(card('r3').classList.contains('drop-after'));
  drag(card('r3'), 'dragover', { clientY: 5 });
  assert.ok(card('r3').classList.contains('drop-before'));
  drag(card('r3'), 'dragleave', { relatedTarget: card('r3').querySelector('.rule-name') });
  assert.ok(card('r3').classList.contains('drop-before'), 'moving within the card keeps the mark');
  drag(card('r3'), 'dragleave', { relatedTarget: null });
  assert.ok(!card('r3').classList.contains('drop-before'));
  drag(card('r3'), 'dragover', { clientY: 30 });
  drag(card('r3'), 'drop');
  assert.deepEqual(ruleOrder(), ['r2', 'r3', 'r1']);

  sized();
  drag(card('r1').querySelector('.rule-drag'), 'dragstart');
  drag(card('r2'), 'dragover', { clientY: 5 });
  drag(card('r2'), 'drop');
  assert.deepEqual(ruleOrder(), ['r1', 'r2', 'r3']);

  drag(card('r1').querySelector('.rule-drag'), 'dragstart');
  drag(card('r1').querySelector('.rule-drag'), 'dragend');
  const stray = drag(card('r2'), 'drop');
  assert.equal(stray.event.defaultPrevented, false, 'a drop after the drag ended does nothing');
  assert.equal($('.view-header .muted.small').textContent, '', 'back in the saved order, nothing is left to save');
});

test('with no rules the list says how to start', async () => {
  await reset({ rules: [] });
  assert.equal($('.rule-list-box .empty-state p').textContent, 'No rules yet. Use “+ Rule” to add one.');
  assert.equal($('details.unmatched'), null);
});

test('preview groups follow the order of the rules, not of the bookmarks', async () => {
  const tips = rule('t1', 'Tips', [cond('kt', 'title', 'contains', 'tips')], [move('mt', 'Bookmarks Toolbar')]);
  const book = rule('b1', 'Book', [cond('kb', 'title', 'contains', 'book')], [move('mb', 'Bookmarks Toolbar')]);
  const headings = () => $$('.group-title > span').map((span) => span.textContent).filter((text) => / — \d+$/.test(text));

  await reset({ rules: [tips, book] });
  assert.deepEqual(headings(), ['Tips — 1', 'Book — 1']);

  await reset({ rules: [book, tips] });
  assert.deepEqual(headings(), ['Book — 1', 'Tips — 1']);
});
