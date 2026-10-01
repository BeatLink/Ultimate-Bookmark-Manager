import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, settle, uninstallDom } from './browser-env.js';

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
const rule = (id, name, conditions, target, extra = {}) => ({
  id, name, enabled: true, query: { id: `${id}-q`, combinator: 'or', not: false, rules: conditions }, target, outranks: [], createdAt: 1, ...extra,
});
const rustRule = (extra) => rule('r1', 'Rust', [cond('k1', 'title', 'contains', 'rust')], 'Bookmarks Menu/Dev/Rust', extra);
const goRule = (extra) => rule('r2', 'Go', [cond('k2', 'title', 'contains', 'go')], 'Bookmarks Menu/Dev', extra);

const browser = installBrowser({ page: 'app.html', tree });
browser.storage.local.data.settings = { organize: { rules: [rustRule(), goRule()], autoApply: false } };
location.hash = '#organize';
await import('../src/ui/app.js');
await settle(20);

after(uninstallDom);

const view = () => document.querySelector('#main section.organize');
const $ = (sel) => view().querySelector(sel);
const $$ = (sel) => [...view().querySelectorAll(sel)];
const card = (id) => $(`[data-rule="${id}"]`);
const folder = (key) => $(`[data-folder="${key}"]`);
const byText = (text, scope = view()) => [...scope.querySelectorAll('button')].find((b) => b.textContent === text);
const toasts = () => [...document.querySelectorAll('#toasts .toast')].map((t) => t.firstChild.textContent);
const saved = () => browser.storage.local.data.settings.organize;
const previewTitle = () => $$('h2').map((h) => h.textContent).find((t) => t.startsWith('Preview'));
const parentOf = async (id) => (await browser.bookmarks.get(id))[0].parentId;
// A pending refresh from storage or bookmark events runs within half a second; waiting it out keeps the page still.
const quiet = () => settle(600);

// Saves organize settings straight into storage and reloads the page from them.
async function reset(organize, { open = [] } = {}) {
  // A rule menu left open by a test would hold back the page's refreshes.
  document.querySelector('dialog.menu')?.close();
  browser.storage.local.data.settings = { organize: { autoApply: false, ...organize } };
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

const head = (key) => folder(key).querySelector(':scope > .folder-head');

test('the page lists folders with their rules and previews the moves', () => {
  assert.equal(document.title, 'Organize — Ultimate Bookmark Manager');
  assert.ok(folder('Bookmarks Menu/Dev/Rust').contains(card('r1')));
  assert.ok(folder('Bookmarks Menu/Dev').contains(card('r2')));
  assert.equal(head('Bookmarks Menu/Dev/Rust').querySelector('.rule-badge.active').textContent, '3 would move here');
  assert.equal(head('Bookmarks Menu/Dev').querySelector('.rule-badge.active').hidden, true);
  assert.equal(card('r1').querySelector('.rule-badge').textContent, '3 to move');
  assert.equal(card('r2').querySelector('.rule-badge').textContent, '0 to move');
  assert.equal(card('r1').querySelector('.score-chip').textContent, '≤ keywords 20');
  assert.equal(card('r1').querySelector('.rule-body').hidden, true, 'saved rules start closed');
  assert.equal(previewTitle(), 'Preview: 3 bookmark(s) to move');
  assert.equal($('.group-title span').textContent, '→ Bookmarks Menu › Dev › Rust — 3');
  assert.equal(byText('Move selected').disabled, false);
  assert.equal($('.unmatched summary h2').textContent, 'Not matched by any rule: 1 bookmark(s)');
  assert.equal(document.querySelector('#nav a.active .badge').textContent, '3');
});

test('opening a rule shows its editor and what it matches', () => {
  card('r1').querySelector('.rule-name').click();
  const body = card('r1').querySelector('.rule-body');
  assert.equal(body.hidden, false);
  assert.equal(card('r1').querySelector('.rule-toggle').getAttribute('aria-expanded'), 'true');
  assert.ok(card('r1').classList.contains('open'));
  assert.equal(body.querySelector('.query-box .keyword').value, 'rust');
  assert.equal(body.querySelector('.rule-info').textContent, 'Matches 3 bookmark(s) and wins 3: 3 would move, the rest are already in place.');
  card('r1').querySelector('.rule-toggle').click();
  assert.equal(body.hidden, true);
  assert.equal(card('r1').querySelector('.rule-toggle').getAttribute('aria-label'), 'Edit rule');
  card('r1').querySelector('.rule-toggle').click();
  assert.equal(body.childElementCount, 4, 'the editor is built only once');
});

test('editing a keyword marks unsaved changes and refreshes the preview after a pause', async () => {
  setValue(card('r1').querySelector('.keyword'), 'rust book', 'input');
  assert.equal($('.view-header .muted.small').textContent, 'Unsaved changes');
  assert.equal(previewTitle(), 'Preview: 3 bookmark(s) to move');
  await settle(350);
  assert.equal(previewTitle(), 'Preview: 1 bookmark(s) to move');
  assert.equal(card('r1').querySelector('.rule-badge').textContent, '1 to move');
  byText('Discard changes').click();
  assert.equal(previewTitle(), 'Preview: 3 bookmark(s) to move');
  assert.equal($('.view-header .muted.small').textContent, '');
});

test('saving writes the edited rules and the auto-organize switch to storage', async () => {
  setValue(card('r1').querySelector('.keyword'), 'rust', 'input');
  setChecked($('.check-line input[type=checkbox]'), true);
  assert.equal($('.view-header .muted.small').textContent, 'Unsaved changes');
  byText('Save rules').click();
  await settle(20);
  assert.equal(saved().autoApply, true);
  assert.equal(saved().rules[0].query.rules[0].value, 'rust');
  assert.ok(toasts().includes('Rules saved.'));
  assert.equal($('.view-header .muted.small').textContent, '');
  await quiet();
});

test('an unticked move stays unticked, and applying moves only the ticked bookmarks', async () => {
  await reset({ rules: [rustRule(), goRule()] });
  const box = (id) => $(`input[data-sel="${id}"]`);
  setChecked(box('e'), false);
  assert.equal(byText('Move selected').disabled, false);
  document.querySelector('[data-action=reload]').click();
  await settle(20);
  assert.equal(box('e').checked, false, 'a refresh keeps it unticked');

  byText('Move selected').click();
  let dialog = await answer('.confirm', 'cancel');
  assert.ok(dialog.querySelector('p').textContent.startsWith('Move 2 bookmark(s) into their rule folders?'));
  assert.equal(await parentOf('a'), 'menu________', 'a cancel moves nothing');

  setChecked($('.check-line input[type=checkbox]'), true);
  byText('Move selected').click();
  dialog = await answer('.confirm', 'ok');
  assert.ok(dialog.querySelector('p').textContent.endsWith('Your rule changes will be saved too.'));
  await settle(20);
  assert.equal(await parentOf('a'), 'rustdir');
  assert.equal(await parentOf('b'), 'rustdir');
  assert.equal(await parentOf('e'), 'unfiled_____');
  assert.equal(saved().autoApply, true, 'the unsaved switch was saved');
  assert.ok(toasts().includes('Moved 2 bookmark(s).'));
  assert.equal(previewTitle(), 'Preview: 1 bookmark(s) to move');
  assert.equal(byText('Move selected').disabled, true);

  byText('Select all').click();
  assert.equal(box('e').checked, true);
  byText('Select group').click();
  assert.equal(box('e').checked, false);
  byText('Select group').click();
  byText('Move selected').click();
  dialog = await answer('.confirm', 'ok');
  assert.ok(!dialog.querySelector('p').textContent.includes('saved too'));
  await settle(20);
  assert.equal(await parentOf('e'), 'rustdir');
  assert.equal($('.empty-state p').textContent, 'Nothing to move: every matching bookmark is already in its folder.');
  await quiet();
  for (const id of ['a', 'b']) await browser.bookmarks.move(id, { parentId: 'menu________' });
  await browser.bookmarks.move('e', { parentId: 'unfiled_____' });
  await quiet();
});

test('the ranking list shows every matching rule and highlights what each matched', async () => {
  const notTips = rule('x', '', [cond('x1', 'title', 'doesNotContain', 'zzz'), { id: 'x2', field: 'folder', operator: 'inFolder', value: 'Other Bookmarks' }], 'Bookmarks Toolbar');
  notTips.query.combinator = 'and';
  await reset({ rules: [rustRule(), goRule(), notTips] });
  const row = $('input[data-sel="e"]').closest('.item');
  assert.match(row.textContent, /Rule: Rust · keywords 20 · beat 1 other matching rule\(s\)/);
  assert.equal(row.querySelector('.matched').textContent, 'Matched “rust” in title');
  const details = row.querySelector('details.ranking');
  assert.equal(details.querySelector('summary').textContent, 'All 2 matching rules');
  details.open = true;
  details.dispatchEvent(new Event('toggle'));
  const items = [...details.querySelectorAll('li')];
  assert.equal(items.length, 2);
  assert.equal(items[0].querySelector('.won-label').textContent, 'Wins');
  assert.equal(items[1].querySelector('strong').textContent, 'Unnamed rule');
  assert.match(items[1].querySelector('.lost-reason').textContent, /^Lost: less specific/);
  details.dispatchEvent(new Event('toggle'));
  assert.equal(details.querySelectorAll('li').length, 2, 'the list is built once');

  items[1].querySelector('.ranking-pick').click();
  assert.equal(row.querySelector('.matched').textContent, 'Unnamed rule matched nothing to highlight');
  assert.equal(items[1].querySelector('.ranking-pick').getAttribute('aria-pressed'), 'true');
  assert.equal(items[0].querySelector('.ranking-pick').getAttribute('aria-pressed'), 'false');
  assert.equal(row.querySelector('.bm-title mark'), null);
  items[0].querySelector('.ranking-pick').click();
  assert.equal(row.querySelector('.matched').textContent, 'Matched “rust” in title');
  assert.equal(row.querySelector('.bm-title mark').textContent, 'rust');
  details.open = false;
  details.dispatchEvent(new Event('toggle'));
});

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
  assert.equal($('details.unmatched .group-title').textContent, 'Bookmarks Menu — 1');
  $('details.unmatched').open = false;
  $('details.unmatched').dispatchEvent(new Event('toggle'));
});

test('a long preview or unmatched list shows its first two hundred rows until asked', async () => {
  const many = await Promise.all(Array.from({ length: 202 }, (_, i) => browser.bookmarks.create({ parentId: 'toolbar_____', title: `Rust extra ${i}`, url: `https://x${i}.test/` })));
  const misc = await Promise.all(Array.from({ length: 201 }, (_, i) => browser.bookmarks.create({ parentId: 'toolbar_____', title: `Misc ${i}`, url: `https://m${i}.test/` })));
  await quiet();
  const group = $$('.groups .group').find((g) => g.querySelector('.group-title').textContent.startsWith('→'));
  assert.equal(group.querySelectorAll('.item').length, 200);
  byText('Show 5 more (5 not shown)', group).click();
  assert.equal(group.querySelectorAll('.item').length, 205);
  assert.equal(group.querySelector('.show-more').hidden, true);

  const details = $('details.unmatched');
  details.open = true;
  details.dispatchEvent(new Event('toggle'));
  const toolbar = [...details.querySelectorAll('.group')].find((g) => g.textContent.startsWith('Bookmarks Toolbar'));
  assert.equal(toolbar.querySelectorAll('.item').length, 200);
  byText('Show 1 more (1 not shown)', toolbar).click();
  assert.equal(toolbar.querySelectorAll('.item').length, 201);
  details.open = false;
  details.dispatchEvent(new Event('toggle'));
  for (const b of [...many, ...misc]) await browser.bookmarks.remove(b.id);
  await quiet();
});

test('the rule menu renames, duplicates, moves and deletes a rule', async () => {
  await reset({ rules: [rustRule(), goRule({ outranks: ['r1'] })] });
  menuItem('r1', 'Rename…').click();
  await answer('.prompt', 'ok', 'Rusty');
  assert.equal(card('r1').querySelector('.rule-name').textContent, 'Rusty');
  menuItem('r1', 'Rename…').click();
  await answer('.prompt', 'cancel');
  menuItem('r1', 'Rename…').click();
  assert.equal((await lastDialog('.prompt')).querySelector('input').value, 'Rusty');
  await answer('.prompt', 'ok', 'Rusty');
  assert.equal(card('r1').querySelector('.rule-name').textContent, 'Rusty');

  menuItem('r1', 'Duplicate').click();
  const copy = card('r1').nextElementSibling;
  assert.equal(copy.querySelector('.rule-name').textContent, 'Rusty (copy)');
  assert.equal(copy.querySelector('.rule-body').hidden, false, 'a copy opens for editing');

  menuItem('r1', 'Move…').click();
  await pick('data-path', 'Bookmarks Toolbar');
  assert.ok(folder('Bookmarks Toolbar').contains(card('r1')));
  menuItem('r1', 'Move…').click();
  await answer('.folder-picker', 'cancel');
  menuItem('r1', 'Move…').click();
  await pick('data-path', 'Bookmarks Toolbar');
  assert.ok(folder('Bookmarks Toolbar').contains(card('r1')));

  menuItem('r1', 'Delete').click();
  assert.equal(card('r1'), null);
  byText('Save rules').click();
  await settle(20);
  assert.deepEqual(saved().rules.map((r) => r.name), ['Rusty (copy)', 'Go']);
  assert.deepEqual(saved().rules[1].outranks, [], 'other rules stop ranking against it');
  await quiet();
});

test('merging a rule into another joins their conditions after a confirmation', async () => {
  const twin = rule('r5', '', [cond('k6', 'title', 'contains', 'cargo')], 'Bookmarks Menu/Dev/Rust');
  const homeless = rule('r6', '', [cond('k7', 'title', 'contains', 'zig')], '');
  await reset({ rules: [rustRule(), goRule(), twin, homeless] });
  menuItem('r5', 'Merge…').click();
  await pick('data-id', 'r1');
  let dialog = await answer('.confirm', 'cancel');
  assert.equal(dialog.querySelector('p').textContent, 'Merge “Rust” into “Unnamed rule”? This rule will match whatever either of them matched, and “Rust” is removed.');
  assert.equal(menuItem('r6', 'Move…').title, 'Choose the folder this rule files into');
  document.querySelector('dialog.menu').close();
  menuItem('r6', 'Merge…').click();
  dialog = await lastDialog('.folder-picker');
  assert.equal(dialog.querySelector('h2').textContent, 'Merge into “Unnamed rule”');
  await pick('data-id', 'r2');
  dialog = await answer('.confirm', 'cancel');
  assert.match(dialog.querySelector('p').textContent, /go to this rule’s folder instead\.$/);
  await reset({ rules: [rustRule(), goRule()] });

  menuItem('r1', 'Merge…').click();
  dialog = await lastDialog('.folder-picker');
  assert.equal(dialog.querySelector('h2').textContent, 'Merge into “Rust”');
  await pick('data-id', 'r2');
  dialog = await answer('.confirm', 'cancel');
  assert.match(dialog.querySelector('p').textContent, /Bookmarks it matches will go to Bookmarks Menu › Dev › Rust instead\./);
  assert.ok(card('r2'));

  menuItem('r1', 'Merge…').click();
  await answer('.folder-picker', 'cancel');
  assert.ok(card('r2'));

  menuItem('r1', 'Merge…').click();
  await pick('data-id', 'r2');
  await answer('.confirm', 'ok');
  assert.equal(card('r2'), null);
  assert.deepEqual([...card('r1').querySelectorAll('.keyword')].map((k) => k.value), ['rust', 'go']);
  assert.equal(card('r1').querySelector('.rule-body').hidden, false);
  assert.equal(menuItem('r1', 'Merge…').disabled, true, 'with one rule left there is nothing to merge');
  assert.equal(menuItem('r1', 'Move…').title, 'Choose the folder this rule files into (now Bookmarks Menu › Dev › Rust)');
  document.querySelector('dialog.menu').close();
});

test('moving a condition to a new rule adds a rule with the same destination', async () => {
  await reset({ rules: [rule('r1', 'Rust', [cond('k1', 'title', 'contains', 'rust'), cond('k3', 'title', 'contains', 'cargo')], 'Bookmarks Menu/Dev/Rust'), goRule()] }, { open: ['r1'] });
  card('r1').querySelector('[data-rule-id="k3"] [aria-label="Move to a new rule"]').click();
  await settle(20);
  const part = card('r1').nextElementSibling;
  assert.equal(part.querySelector('.rule-name').textContent, 'Rust (part)');
  assert.equal(part.querySelector('.keyword').value, 'cargo');
  assert.deepEqual([...card('r1').querySelectorAll('.keyword')].map((k) => k.value), ['rust']);
});

test('switching a rule off greys it out and stops it moving anything', async () => {
  await reset({ rules: [rustRule(), goRule()] }, { open: ['r1'] });
  setChecked(card('r1').querySelector('[aria-label="Rule enabled"]'), false);
  assert.ok(card('r1').classList.contains('disabled'));
  assert.equal(card('r1').querySelector('.rule-badge').textContent, 'Off');
  await settle(350);
  assert.equal($('.empty-state p').textContent, 'Nothing to move: every matching bookmark is already in its folder.');
});

test('a rule with problems is flagged, and a rule without a folder is listed apart', async () => {
  const bad = rule('r3', 'Bad', [cond('k4', 'title', 'matchesRegex', '(')], 'Bookmarks Toolbar');
  const homeless = rule('r4', '', [cond('k5', 'title', 'contains', 'cook')], '');
  await reset({ rules: [rustRule(), bad, homeless] }, { open: ['r3'] });
  assert.equal(card('r3').querySelector('.rule-badge').textContent, 'Needs attention');
  assert.match(card('r3').querySelector('.rule-info .error').textContent, /^Invalid regex “\(”/);
  const orphans = $('.orphan-rules');
  assert.ok(orphans.contains(card('r4')));
  assert.equal(card('r4').querySelector('.rule-name').textContent, 'Unnamed rule');
  assert.ok(card('r4').querySelector('.rule-name').classList.contains('unnamed'));
  assert.equal(card('r4').querySelector('.rule-badge').title, 'Choose a target folder.');
});

test('ranking rows set which rules a rule ranks above or below', async () => {
  await reset({ rules: [rustRule(), goRule()] }, { open: ['r1'] });
  const ranking = () => card('r1').querySelector('.rank-rows');
  byText('+ Ranking', card('r1')).click();
  assert.equal(ranking().querySelector('.rank-target').textContent, 'Choose a rule…');
  ranking().querySelector('[aria-label="Remove ranking"]').click();
  assert.equal(ranking().childElementCount, 0, 'an unset row just goes');

  byText('+ Ranking', card('r1')).click();
  ranking().querySelector('.rank-target').click();
  let dialog = await lastDialog('.folder-picker');
  assert.equal(dialog.querySelector('h2').textContent, 'This rule ranks above…');
  assert.ok(dialog.querySelector('.rule-choice[data-id="*"]'), 'all other rules is offered');
  assert.equal(dialog.querySelector('.rule-choice[data-id="r1"]'), null, 'not the rule itself');
  await pick('data-id', 'r2');
  assert.equal(ranking().querySelector('.rank-target').textContent, 'Go → Bookmarks Menu › Dev');
  assert.equal(card('r1').querySelector('.score-chip').textContent, '≤ keywords 20 · above 1');
  assert.ok(card('r1').querySelector('.score-chip').classList.contains('prioritised'));

  ranking().querySelector('.rank-target').click();
  dialog = await pick('data-id', 'r2');
  assert.equal(ranking().childElementCount, 1, 'choosing the same rule changes nothing');

  setValue(ranking().querySelector('.rank-relation'), 'below');
  assert.equal(card('r1').querySelector('.score-chip').textContent, '≤ keywords 20');
  byText('Save rules').click();
  await settle(20);
  assert.deepEqual(saved().rules.map((r) => r.outranks), [[], ['r1']], '“ranks below” is stored in the other rule’s list');
  await quiet();
  card('r2').querySelector('.rule-toggle').click();
  assert.equal(card('r2').querySelector('.rank-target').textContent, 'Rust → Bookmarks Menu › Dev › Rust');

  card('r1').querySelector('[aria-label="Remove ranking"]').click();
  assert.equal(ranking().childElementCount, 0);
  assert.equal(card('r2').querySelector('.rank-rows').childElementCount, 0);

  byText('+ Ranking', card('r1')).click();
  setValue(ranking().querySelector('.rank-relation'), 'below');
  ranking().querySelector('.rank-target').click();
  assert.equal((await lastDialog('.folder-picker')).querySelector('h2').textContent, 'This rule ranks below…');
  await pick('data-id', 'r2');
  assert.equal(card('r2').querySelector('.score-chip').textContent, '≤ keywords 20 · above 1');
});

test('ranking above all other rules sets the tier, and a link against the tiers is refused', async () => {
  await reset({ rules: [rustRule(), goRule({ rankAll: 'below' })] }, { open: ['r1'] });
  assert.equal(card('r2').querySelector('.score-chip').textContent, '≤ keywords 20 · below all');
  const ranking = () => card('r1').querySelector('.rank-rows');
  byText('+ Ranking', card('r1')).click();
  ranking().querySelector('.rank-target').click();
  await pick('data-id', '*');
  assert.equal(ranking().querySelector('.rank-target').textContent, 'all other rules');
  assert.equal(card('r1').querySelector('.score-chip').textContent, '≤ keywords 20 · above all');
  assert.match(card('r1').querySelector('.score-chip').title, /^Ranks above all other rules\./);

  byText('+ Ranking', card('r1')).click();
  ranking().lastElementChild.querySelector('.rank-target').click();
  const dialog = await lastDialog('.folder-picker');
  assert.equal(dialog.querySelector('.rule-choice[data-id="*"]'), null, 'all other rules is taken');
  await pick('data-id', 'r2');
  assert.equal(ranking().childElementCount, 2);

  const toR2 = [...ranking().children].find((r) => r.textContent.includes('Go'));
  setValue(toR2.querySelector('.rank-relation'), 'below');
  assert.ok(toasts().includes('That would make a loop or go against a rule that ranks above or below all others.'));
  assert.deepEqual(saved().rules[0].outranks, [], 'nothing is saved yet');
  assert.equal(card('r1').querySelector('.score-chip').textContent, '≤ keywords 20 · above all · above 1', 'the old link is put back');

  const toAll = [...ranking().children].find((r) => r.textContent.includes('all other rules'));
  setValue(toAll.querySelector('.rank-relation'), 'below');
  assert.equal(card('r1').querySelector('.score-chip').textContent, '≤ keywords 20 · below all · above 1');
  [...ranking().children].find((r) => r.textContent.includes('all other rules')).querySelector('[aria-label="Remove ranking"]').click();
  assert.equal(card('r1').querySelector('.score-chip').textContent, '≤ keywords 20 · above 1');
});

test('rules that rank above each other in a loop, or against the tiers, are warned about', async () => {
  await reset({ rules: [rustRule({ outranks: ['r2'] }), goRule({ outranks: ['r1'] })] }, { open: ['r1'] });
  assert.match(card('r1').querySelector('.rule-info .warn').textContent, /rank above each other in a loop/);
  await reset({ rules: [rustRule({ outranks: ['r2'] }), goRule({ rankAll: 'above' })] }, { open: ['r1'] });
  assert.equal(card('r1').querySelector('.rule-info .warn').textContent, '“Rust” is set to rank above “Go”, but “Go” ranks above all other rules, so that link is ignored.');
});

test('the folder search, the rules-only switch and expand or collapse all filter the tree', async () => {
  await reset({ rules: [rustRule()] });
  const search = $('input[type=search]');
  setValue(search, 'rust', 'input');
  assert.deepEqual($$('.folder-node').map((n) => n.dataset.folder), ['Bookmarks Menu', 'Bookmarks Menu/Dev', 'Bookmarks Menu/Dev/Rust']);
  setValue(search, 'nothing like it', 'input');
  assert.equal($('.rule-tree .empty-state p').textContent, 'No folders match.');
  setValue(search, '', 'input');

  setChecked($('.filters input[type=checkbox]'), true);
  assert.deepEqual($$('.folder-node').map((n) => n.dataset.folder), ['Bookmarks Menu', 'Bookmarks Menu/Dev', 'Bookmarks Menu/Dev/Rust']);
  setChecked($('.filters input[type=checkbox]'), false);

  byText('Collapse all').click();
  assert.equal(folder('Bookmarks Menu').querySelector('.folder-children').hidden, true);
  assert.equal(card('r1'), null, 'closed folders are not built');
  const toggle = head('Bookmarks Menu').querySelector('.folder-toggle');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.getAttribute('aria-label'), 'Collapse Bookmarks Menu');
  head('Bookmarks Menu/Dev').querySelector('.folder-toggle').click();
  head('Bookmarks Menu/Dev/Rust').querySelector('.folder-toggle').click();
  assert.ok(card('r1'));
  assert.equal(head('Bookmarks Menu/Dev/Rust').querySelector('.rule-badge.active').textContent, '3 would move here');
  toggle.click();
  assert.equal(folder('Bookmarks Menu').querySelector('.folder-children').hidden, true);
  toggle.click();
  byText('Expand all').click();
  assert.equal(folder('Bookmarks Toolbar').querySelector('.folder-children').hidden, false);
  assert.equal(head('Bookmarks Toolbar').querySelector('.folder-toggle').hidden, true, 'an empty folder has nothing to open');
});

test('“+ Rule” on a folder adds an open rule that needs a condition', async () => {
  await reset({ rules: [rustRule()] });
  byText('+ Rule', head('Bookmarks Toolbar')).click();
  const added = folder('Bookmarks Toolbar').querySelector('.rule-card');
  assert.equal(added.querySelector('.rule-body').hidden, false);
  assert.equal(added.querySelector('.rule-badge').textContent, 'Needs attention');
  assert.equal(added.querySelector('.rule-info .error').textContent, 'Add a condition on the title or URL; folder conditions only narrow a rule down.');
  assert.equal($('.view-header .muted.small').textContent, 'Unsaved changes');
});

test('“+ Rule for a new folder” adds a rule for a folder that does not exist yet', async () => {
  await reset({ rules: [rustRule()] });
  byText('+ Rule for a new folder').click();
  await answer('.folder-picker', 'cancel');
  assert.equal($('.orphan-rules'), null);
  byText('+ Rule for a new folder').click();
  const dialog = await lastDialog('.folder-picker');
  dialog.querySelector('[data-path="Bookmarks Toolbar"]').click();
  dialog.querySelector('input[aria-label="New subfolder name"]').value = 'Reading';
  dialog.close('ok');
  await settle(20);
  assert.equal($('.orphan-rules h2').firstChild.textContent, 'Rules for folders that do not exist yet ');
  assert.equal($('.orphan-rules .rule-card .rule-body').hidden, false);
});

test('“+ Folder” creates a subfolder unless one of that name is already there', async () => {
  await reset({ rules: [rustRule()] });
  byText('+ Folder', head('Bookmarks Menu/Dev')).click();
  await answer('.prompt', 'ok', 'Rust');
  assert.ok(toasts().includes('Dev already has a folder called “Rust”.'));
  byText('+ Folder', head('Bookmarks Menu/Dev')).click();
  await answer('.prompt', 'cancel');
  byText('+ Folder', head('Bookmarks Menu/Dev')).click();
  const dialog = await answer('.prompt', 'ok', 'Python');
  assert.equal(dialog.querySelector('span').textContent, 'Name of the new folder in Dev');
  await settle(20);
  assert.ok(toasts().includes('Created “Python”.'));
  assert.ok(folder('Bookmarks Menu/Dev/Python'));
  const created = (await browser.bookmarks.getChildren('dev')).find((n) => n.title === 'Python');
  await quiet();
  await browser.bookmarks.remove(created.id);
  await quiet();
});

test('a rule dragged onto a folder files into it from then on', async () => {
  await reset({ rules: [rustRule()] });
  const handle = card('r1').querySelector('.rule-drag');
  const start = drag(handle, 'dragstart');
  assert.equal(start.dataTransfer.data['application/x-organize-rule'], 'r1');
  assert.equal(start.dataTransfer.image[0], card('r1'));
  const own = drag(head('Bookmarks Menu/Dev/Rust'), 'dragover');
  assert.equal(own.event.defaultPrevented, false, 'not onto its own folder');
  const over = drag(head('Bookmarks Toolbar'), 'dragover');
  assert.equal(over.event.defaultPrevented, true);
  assert.ok(head('Bookmarks Toolbar').classList.contains('drop-into'));
  drag(head('Bookmarks Toolbar'), 'dragleave', { relatedTarget: head('Bookmarks Toolbar').querySelector('.folder-title') });
  assert.ok(head('Bookmarks Toolbar').classList.contains('drop-into'));
  drag(head('Bookmarks Toolbar'), 'dragleave', { relatedTarget: null });
  assert.ok(!head('Bookmarks Toolbar').classList.contains('drop-into'));
  drag(head('Bookmarks Toolbar'), 'drop');
  assert.ok(folder('Bookmarks Toolbar').contains(card('r1')));
  assert.equal($('.view-header .muted.small').textContent, 'Unsaved changes');

  drag(card('r1').querySelector('.rule-drag'), 'dragstart');
  drag(head('Bookmarks Toolbar'), 'drop');
  assert.ok(folder('Bookmarks Toolbar').contains(card('r1')), 'a drop on its own folder does nothing');
  drag(card('r1').querySelector('.rule-drag'), 'dragstart');
  drag(card('r1').querySelector('.rule-drag'), 'dragend');
  drag(head('Bookmarks Menu'), 'drop');
  assert.ok(folder('Bookmarks Toolbar').contains(card('r1')), 'nothing is dragged after the drag ends');
});

test('a folder dragged onto another moves there and the rules follow it', async () => {
  await reset({ rules: [rustRule()] });
  assert.equal(head('Bookmarks Menu').getAttribute('draggable'), null, 'root folders stay put');
  drag(head('Bookmarks Menu'), 'dragstart');
  assert.equal(drag(head('Bookmarks Toolbar'), 'dragover').event.defaultPrevented, false);

  drag(head('Bookmarks Menu/Dev'), 'dragstart');
  assert.equal(drag(head('Bookmarks Menu/Dev/Rust'), 'dragover').event.defaultPrevented, false, 'not into itself');
  assert.equal(drag(head('Bookmarks Menu'), 'dragover').event.defaultPrevented, false, 'not where it already is');
  drag(head('Bookmarks Menu/Dev/Rust'), 'drop');
  assert.equal(await parentOf('dev'), 'menu________');

  drag(head('Bookmarks Menu/Dev'), 'dragstart');
  drag(head('Bookmarks Toolbar'), 'drop');
  await settle(20);
  assert.equal(await parentOf('dev'), 'toolbar_____');
  assert.ok(toasts().includes('Moved “Dev” into “Bookmarks Toolbar”.'));
  assert.equal(saved().rules[0].target, 'Bookmarks Toolbar/Dev/Rust');
  assert.ok(folder('Bookmarks Toolbar/Dev/Rust').contains(card('r1')));
  await quiet();

  const clash = await browser.bookmarks.create({ parentId: 'menu________', title: 'Dev' });
  await quiet();
  drag(head('Bookmarks Toolbar/Dev'), 'dragstart');
  drag(head('Bookmarks Menu'), 'drop');
  assert.ok(toasts().includes('Bookmarks Menu already has a folder called “Dev”.'));
  assert.equal(await parentOf('dev'), 'toolbar_____');
  await browser.bookmarks.remove(clash.id);
  await browser.bookmarks.move('dev', { parentId: 'menu________' });
  await quiet();
});

test('with no rules the preview says how to start', async () => {
  await reset({ rules: [] });
  assert.equal($('.empty-state p').textContent, 'No rules yet. Use “+ Rule” on a folder to start organizing.');
  assert.equal($('details.unmatched'), null);
});
