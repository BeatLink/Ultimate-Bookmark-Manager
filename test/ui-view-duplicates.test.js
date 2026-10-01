import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom, settle } from './browser-env.js';
import { openDashboard, main, click, findButton, answer, tick, selectedCount, toasts, clearToasts, reload, show, ids } from './ui-view-helpers.js';

const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'a1', title: 'Alpha one', url: 'https://alpha.test/', dateAdded: 1000 },
    { id: 'a2', title: 'Alpha two', url: 'https://alpha.test/', dateAdded: 2000 },
    { id: 'a3', title: 'Alpha three', url: 'https://alpha.test/', dateAdded: 3000 },
    { id: 'b1', title: 'Beta one', url: 'https://beta.test/', dateAdded: 1500 },
    { id: 'b2', title: 'Beta two', url: 'https://beta.test/', dateAdded: 2500 },
    { id: 'c', title: 'Gamma', url: 'https://gamma.test/', dateAdded: 1200 },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

const browser = await openDashboard({ view: 'duplicates', tree: tree() });
after(uninstallDom);

const rowIds = () => [...main().querySelectorAll('input[data-sel]')].map((b) => b.dataset.sel);

test('each URL bookmarked more than once is listed with its copies oldest first', () => {
  assert.match(main().textContent, /2 URL\(s\) bookmarked more than once, 3 extra copies\./);
  const groups = [...main().querySelectorAll('.group')];
  assert.deepEqual(groups.map((g) => g.querySelector('.group-title').textContent), ['https://alpha.test/', 'https://beta.test/']);
  assert.deepEqual(rowIds(), ['a1', 'a2', 'a3', 'b1', 'b2']);
  assert.deepEqual([...groups[0].querySelectorAll('.order')].map((o) => o.textContent), ['1', '2', '3']);
  assert.equal(groups[0].querySelector('.order').title, 'Added first');
  assert.equal(groups[0].querySelectorAll('.order')[1].title, 'Added #2');
});

test('the navigation badge counts the duplicate groups', () => {
  const link = document.querySelector('#nav a[href="#duplicates"]');
  assert.equal(link.querySelector('.badge').textContent, '2');
  assert.equal(link.getAttribute('aria-current'), 'page');
});

test('the actions stay disabled until something is selected', () => {
  assert.equal(selectedCount(), '0 selected');
  assert.equal(findButton('Remove selected').disabled, true);
  assert.equal(findButton('Ignore').disabled, true);
});

test('All but oldest selects every copy except the first one added', async () => {
  await click('All but oldest');
  assert.equal(selectedCount(), '3 selected');
  assert.deepEqual(rowIds().filter((id) => main().querySelector(`input[data-sel="${id}"]`).checked), ['a2', 'a3', 'b2']);
  assert.equal(findButton('Remove selected').disabled, false);
});

test('All but newest selects every copy except the last one added', async () => {
  await click('All but newest');
  assert.deepEqual(rowIds().filter((id) => main().querySelector(`input[data-sel="${id}"]`).checked), ['a1', 'a2', 'b1']);
});

test('Clear empties the selection', async () => {
  await click('Clear');
  assert.equal(selectedCount(), '0 selected');
  assert.equal(main().querySelectorAll('input[data-sel]:checked').length, 0);
});

test('ticking a checkbox adds that bookmark to the selection', () => {
  tick('b1');
  assert.equal(selectedCount(), '1 selected');
  tick('b1', false);
  assert.equal(selectedCount(), '0 selected');
});

test('cancelling the remove dialog leaves every bookmark in place', async () => {
  tick('a2');
  await click('Remove selected');
  const message = await answer(false);
  assert.equal(message, 'Remove 1 bookmark(s)? You can undo this from the history.');
  assert.ok((await ids(browser)).includes('a2'));
});

test('removing a whole group warns that every copy would be lost', async () => {
  tick('a2', false);
  tick('b1');
  tick('b2');
  await click('Remove selected');
  const message = await answer(false);
  assert.match(message, /Remove 2 bookmark\(s\)\? 1 group\(s\) would lose every copy\./);
  tick('b1', false);
  tick('b2', false);
});

test('confirming the remove dialog deletes the selected copies and offers undo', async () => {
  clearToasts();
  tick('a3');
  await click('Remove selected');
  await answer(true);
  assert.equal((await ids(browser)).includes('a3'), false);
  assert.match(toasts(), /Removed 1 duplicate\(s\)\./);
  assert.deepEqual(rowIds(), ['a1', 'a2', 'b1', 'b2']);
  const { history } = browser.storage.local.data;
  assert.equal(history.entries[0].label, 'Removed 1 duplicate bookmark(s)');
});

test('the toast’s Undo button puts the removed bookmark back', async () => {
  const undo = findButton('Undo', document.getElementById('toasts'));
  undo.click();
  await settle(30);
  const children = await browser.bookmarks.getChildren('menu________');
  assert.ok(children.some((c) => c.title === 'Alpha three' && c.url === 'https://alpha.test/'));
  assert.match(toasts(), /Undone: Removed 1 duplicate bookmark\(s\)/);
  await reload();
  assert.match(main().textContent, /3 extra copies/);
});

test('moving selected copies files them in a Dupes folder in Other Bookmarks', async () => {
  clearToasts();
  tick('b2');
  await click('Move to “Dupes”');
  const [other] = await browser.bookmarks.getSubTree('unfiled_____');
  const dupes = other.children.find((c) => c.title === 'Dupes');
  assert.ok(dupes);
  assert.deepEqual(dupes.children.map((c) => c.id), ['b2']);
  assert.match(toasts(), /Moved 1 bookmark\(s\) to “Dupes”\./);
});

test('ignoring copies adds them to the whitelist and drops them from the list', async () => {
  tick('b1');
  tick('b2');
  await click('Ignore');
  const { whitelist } = browser.storage.local.data;
  assert.deepEqual(Object.keys(whitelist).sort(), ['b1', 'b2']);
  assert.deepEqual(whitelist.b1, { title: 'Beta one', url: 'https://beta.test/' });
  assert.deepEqual(main().querySelectorAll('.group').length, 1);
});

test('an invalid custom rule is reported above the list', async () => {
  await browser.storage.local.set({ settings: { rules: [{ kind: 'replace', pattern: '(', flags: '' }] } });
  await reload();
  assert.match(main().querySelector('.error').textContent, /1 custom rule\(s\) are invalid and were skipped/);
});

test('Matching options opens the Settings page', async () => {
  await click('Matching options…');
  assert.equal(location.hash, '#settings');
  assert.equal(main().querySelector('h1').textContent, 'Settings');
  await show('duplicates');
});

test('a single extra copy is counted in the singular', async () => {
  await browser.bookmarks.remove('a2');
  await reload();
  assert.match(main().textContent, /1 URL\(s\) bookmarked more than once, 1 extra copy\./);
});

test('with no duplicates left the page says so', async () => {
  await browser.bookmarks.remove('a1');
  await reload();
  assert.match(main().textContent, /0 URL\(s\) bookmarked more than once, 0 extra copies\./);
  assert.equal(main().querySelector('.empty-state').textContent, 'No duplicates found.');
});
