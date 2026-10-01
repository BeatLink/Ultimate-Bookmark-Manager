import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom, settle } from './browser-env.js';
import { openDashboard, main, click, findButton, answer, toasts, clearToasts, reload, catchDownloads } from './ui-view-helpers.js';
import { Actions } from '../src/lib/actions.js';

const browser = await openDashboard({ view: 'history' });
after(uninstallDom);

const downloads = catchDownloads();

const entries = () => [...main().querySelectorAll('ol.history > li')];

// Hands a file to one of the page's hidden file inputs, as picking it in the file dialog would.
function pick(input, file) {
  Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
  input.dispatchEvent(new Event('change'));
}

test('with no changes recorded the page says there is nothing to undo', () => {
  assert.equal(main().querySelector('h1').textContent, 'History & backup');
  assert.equal(main().querySelector('.empty-state').textContent, 'Nothing to undo yet.');
});

test('each recorded change is listed newest first with what it did', async () => {
  const older = { id: 'old', time: Date.now() - 1000, label: 'An older change', ops: [
    { kind: 'remove', snapshot: { type: 'bookmark', title: '', url: 'https://gone.test/' } },
    { kind: 'remove', snapshot: { type: 'separator', title: '' } },
    { kind: 'update', before: { title: 'Old name', url: 'https://old.test/' } },
    { kind: 'move' },
    { kind: 'rulePaths', to: ['Bookmarks Menu', 'Work'] },
    { kind: 'create' },
  ] };
  await browser.storage.local.set({ history: { entries: [older], idMap: {}, redo: [] } });
  await new Actions().remove(['a'], 'Removed Alpha');
  await reload();
  await settle(10);
  assert.deepEqual(entries().map((li) => li.querySelector('.bm-title').textContent), ['Removed Alpha', 'An older change']);
  assert.match(entries()[0].textContent, /1 change\(s\)/);
  assert.deepEqual([...entries()[1].querySelectorAll('.ops li')].map((li) => li.textContent), [
    'Removed bookmark “https://gone.test/”',
    'Removed separator “”',
    'Changed title and url (was “Old name”, “https://old.test/”)',
    'Moved an item',
    'Pointed organize rules at “Bookmarks Menu › Work”',
    'Created an item',
  ]);
  assert.equal(entries()[0].querySelector('.ops li').textContent, 'Removed bookmark “Alpha”');
});

test('only the newest change has an Undo button', () => {
  assert.ok(findButton('Undo', entries()[0]));
  assert.equal(findButton('Undo', entries()[1]), undefined);
});

test('Undo reverts the newest change and offers to redo it', async () => {
  clearToasts();
  await click('Undo', entries()[0]);
  await settle(10);
  const children = await browser.bookmarks.getChildren('menu________');
  assert.ok(children.some((c) => c.title === 'Alpha'));
  assert.match(toasts(), /Undone: Removed Alpha/);
  assert.equal(main().querySelector('.redo-row span').textContent, 'Undone: Removed Alpha');
  assert.deepEqual(entries().map((li) => li.querySelector('.bm-title').textContent), ['An older change']);
});

test('Redo applies the undone change again', async () => {
  clearToasts();
  await click('Redo');
  await settle(10);
  const children = await browser.bookmarks.getChildren('menu________');
  assert.equal(children.some((c) => c.title === 'Alpha'), false);
  assert.match(toasts(), /Redone: Removed Alpha/);
  assert.equal(main().querySelector('.redo-row'), null);
});

test('clearing the history asks first and forgets every entry when confirmed', async () => {
  await click('Clear history');
  assert.equal(await answer(false), 'Forget all undo history? The changes themselves stay.');
  assert.equal(entries().length, 2);
  await click('Clear history');
  await answer(true);
  await settle(10);
  assert.deepEqual(browser.storage.local.data.history.entries, []);
  assert.equal(main().querySelector('.empty-state').textContent, 'Nothing to undo yet.');
});

test('Download full backup saves every bookmark as JSON', async () => {
  clearToasts();
  await click('Download full backup (JSON)');
  assert.equal(downloads.length, 1);
  assert.match(downloads[0].name, /^bookmarks-backup-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(location.hash, '#history');
  const backup = JSON.parse(await downloads[0].blob.text());
  assert.equal(backup.format, 'bookmark-manager-backup');
  const menu = backup.tree.children.find((c) => c.id === 'menu________');
  assert.deepEqual(menu.children.map((c) => c.title), ['Beta']);
  assert.match(toasts(), /Backup downloaded\./);
});

test('Restore from backup opens the file picker', async () => {
  const input = main().querySelector('input[type=file]');
  let opened = 0;
  input.addEventListener('click', () => opened++);
  await click('Restore from backup…');
  assert.equal(opened, 1);
  assert.equal(input.getAttribute('accept'), '.json,application/json');
});

test('restoring from a file that is not a backup reports why', async () => {
  clearToasts();
  const input = main().querySelector('input[type=file]');
  pick(input, new File(['not json'], 'notes.txt'));
  await settle(10);
  assert.match(document.querySelector('#toasts .error').textContent, /This is not a JSON file\./);
  assert.equal(document.querySelector('dialog[open]'), null);
});

test('choosing no file does nothing', async () => {
  pick(main().querySelector('input[type=file]'), null);
  await settle(10);
  assert.equal(document.querySelector('dialog[open]'), null);
});

test('restoring a backup replaces the bookmarks after asking, and can be undone', async () => {
  const backup = { format: 'bookmark-manager-backup', version: 1, tree: { children: [
    { id: 'menu________', children: [{ title: 'Restored', url: 'https://restored.test/' }, { title: 'Search', url: 'place:sort=8' }] },
  ] } };
  const input = main().querySelector('input[type=file]');
  pick(input, new File([JSON.stringify(backup)], 'backup.json'));
  await settle(10);
  assert.equal(await answer(false), 'Replace all your bookmarks with the 1 in this backup? 1 saved search(es) will be left out, as Firefox does not let add-ons create them. You can undo this.');
  assert.deepEqual((await browser.bookmarks.getChildren('menu________')).map((c) => c.title), ['Beta']);

  clearToasts();
  pick(main().querySelector('input[type=file]'), new File([JSON.stringify(backup)], 'backup.json'));
  await settle(10);
  await answer(true);
  await settle(10);
  assert.deepEqual((await browser.bookmarks.getChildren('menu________')).map((c) => c.title), ['Restored']);
  assert.match(toasts(), /Restored 1 bookmark\(s\) from the backup\./);
  assert.equal(entries()[0].querySelector('.bm-title').textContent, 'Restored 1 bookmark(s) from a backup');
});
