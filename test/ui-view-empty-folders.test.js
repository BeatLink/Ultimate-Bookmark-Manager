import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom } from './browser-env.js';
import { openDashboard, main, click, findButton, answer, tick, selectedCount, toasts, clearToasts, reload, ids } from './ui-view-helpers.js';

const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'keep', title: 'Keep', children: [{ id: 'k1', title: 'Kept', url: 'https://kept.test/' }, { id: 'inner', title: 'Inner', children: [] }] },
    { id: 'shell', title: 'Shell', children: [{ id: 's1', title: 'Sub', children: [{ id: 's2', title: 'Deeper', children: [] }] }] },
    { id: 'blank', title: '', children: [] },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [{ id: 'lonely', title: 'Lonely', children: [] }] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

const browser = await openDashboard({ view: 'empty-folders', tree: tree() });
after(uninstallDom);

const rows = () => [...main().querySelectorAll('.item')];

test('only the outermost empty folders are listed, with their place and empty subfolders', () => {
  assert.deepEqual([...main().querySelectorAll('input[data-sel]')].map((b) => b.dataset.sel), ['inner', 'shell', 'blank', 'lonely']);
  const shell = rows()[1];
  assert.match(shell.textContent, /Shell/);
  assert.match(shell.textContent, /Bookmarks Menu/);
  assert.match(shell.textContent, /2 empty subfolder\(s\)/);
  assert.match(rows()[2].textContent, /\(no name\)/);
  assert.doesNotMatch(rows()[3].textContent, /subfolder/);
  assert.equal(document.querySelector('#nav a[href="#empty-folders"] .badge').textContent, '4');
});

test('Select all ticks every folder, and pressing it again unticks them', async () => {
  await click('Select all');
  assert.equal(selectedCount(), '4 selected');
  await click('Select all');
  assert.equal(selectedCount(), '0 selected');
  assert.equal(findButton('Remove selected').disabled, true);
});

test('cancelling the remove dialog keeps the folders', async () => {
  tick('blank');
  await click('Remove selected');
  assert.equal(await answer(false), 'Remove 1 empty folder(s)?');
  assert.ok((await ids(browser)).includes('blank'));
});

test('confirming removes the selected folders with their empty subfolders', async () => {
  clearToasts();
  tick('shell');
  await click('Remove selected');
  assert.equal(await answer(true), 'Remove 2 empty folder(s)?');
  const left = await ids(browser);
  for (const id of ['shell', 's1', 's2', 'blank']) assert.equal(left.includes(id), false, id);
  assert.match(toasts(), /Removed 2 folder\(s\)\./);
  assert.equal(browser.storage.local.data.history.entries[0].label, 'Removed 2 empty folder(s)');
  assert.deepEqual([...main().querySelectorAll('input[data-sel]')].map((b) => b.dataset.sel), ['inner', 'lonely']);
});

test('ignoring a folder adds it to the whitelist and hides it', async () => {
  tick('lonely');
  await click('Ignore');
  assert.deepEqual(browser.storage.local.data.whitelist, { lonely: { title: 'Lonely', url: '' } });
  assert.deepEqual([...main().querySelectorAll('input[data-sel]')].map((b) => b.dataset.sel), ['inner']);
});

test('with no empty folders the page says so', async () => {
  await browser.bookmarks.create({ parentId: 'inner', title: 'Now full', url: 'https://full.test/' });
  await reload();
  assert.equal(main().querySelector('.empty-state').textContent, 'No empty folders.');
});
