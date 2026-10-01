import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom } from './browser-env.js';
import { openDashboard, main, click, findButton, tick, selectedCount, toasts, clearToasts, reload, show } from './ui-view-helpers.js';

const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'r1', title: 'Docs', url: 'http://docs.test/a' },
    { id: 'r2', title: 'Blog', url: 'https://blog.test/old' },
    { id: 'r3', title: 'Shop', url: 'https://shop.test/' },
    { id: 'r4', title: 'News', url: 'https://news.test/' },
    { id: 'b', title: 'Broken', url: 'https://broken.test/' },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

const redirect = (id, url, finalUrl) => ({ id, url, finalUrl, status: 'redirect', httpStatus: 200 });
const linkResults = {
  time: Date.now(), checked: 5, skipped: 0,
  results: [
    redirect('r1', 'http://docs.test/a', 'https://docs.test/a'),
    redirect('r2', 'https://blog.test/old', 'https://blog.test/new'),
    redirect('r3', 'https://shop.test/', 'https://parked.example/'),
    redirect('r4', 'https://news.test/', 'https://news.test/today'),
    { id: 'b', url: 'https://broken.test/', status: 'broken', category: 'notFound', httpStatus: 404 },
  ],
};

const browser = await openDashboard({ view: 'redirects', tree: tree() });
after(uninstallDom);

const urlOf = async (id) => (await browser.bookmarks.get(id))[0].url;
const listed = () => [...main().querySelectorAll('input[data-sel]')].map((b) => b.dataset.sel);

test('before any check the page says links have not been checked', () => {
  assert.match(main().textContent, /Links have not been checked yet\./);
  assert.equal(main().querySelector('.selection-bar'), null);
});

test('each redirect shows where it now leads, and redirects to another site are flagged', async () => {
  await browser.storage.local.set({ linkResults });
  await reload();
  assert.deepEqual(listed(), ['r1', 'r2', 'r3', 'r4']);
  const row = (id) => main().querySelector(`input[data-sel="${id}"]`).closest('.item');
  assert.equal(row('r2').querySelector('.redirect-to a').getAttribute('href'), 'https://blog.test/new');
  assert.match(row('r3').querySelector('.warn').textContent, /Different site: shop\.test → parked\.example/);
  assert.equal(row('r1').querySelector('.warn'), null, 'http to https on the same site is not flagged');
  assert.equal(main().querySelector('p.warn').textContent, '1 of these go to a different site; check those before fixing.');
});

test('Fix all is available with nothing selected while the other actions wait for a selection', () => {
  assert.equal(selectedCount(), '0 selected');
  assert.equal(findButton('Fix all (4)').disabled, false);
  assert.equal(findButton('Fix selected').disabled, true);
  assert.equal(findButton('Ignore').disabled, true);
});

test('a row’s Fix button replaces that bookmark’s URL with the one it leads to', async () => {
  clearToasts();
  const row = main().querySelector('input[data-sel="r2"]').closest('.item');
  await click('Fix', row);
  assert.equal(await urlOf('r2'), 'https://blog.test/new');
  assert.match(toasts(), /Updated 1 URL\(s\)\./);
  assert.equal(browser.storage.local.data.history.entries[0].label, 'Updated 1 redirected URL(s)');
  assert.deepEqual(listed(), ['r1', 'r3', 'r4']);
});

test('Fix selected updates just the ticked bookmarks', async () => {
  tick('r1');
  assert.equal(selectedCount(), '1 selected');
  await click('Fix selected');
  assert.equal(await urlOf('r1'), 'https://docs.test/a');
  assert.equal(await urlOf('r3'), 'https://shop.test/');
});

test('Select all ticks every redirect', async () => {
  await click('Select all');
  assert.equal(selectedCount(), '2 selected');
  await click('Select all');
  assert.equal(selectedCount(), '0 selected');
});

test('ignoring a redirect adds it to the whitelist', async () => {
  tick('r3');
  await click('Ignore');
  assert.deepEqual(Object.keys(browser.storage.local.data.whitelist), ['r3']);
  assert.deepEqual(listed(), ['r4']);
  assert.equal(main().querySelector('p.warn'), null);
});

test('Fix all updates every redirect still listed', async () => {
  await click('Fix all (1)');
  assert.equal(await urlOf('r4'), 'https://news.test/today');
  assert.equal(main().querySelector('.empty-state').textContent, 'No redirects found.');
});

test('the Check again button starts a new link check', async () => {
  const request = browser.permissions.request;
  browser.permissions.request = async () => false;
  await click('Check again');
  browser.permissions.request = request;
  assert.match(toasts(), /Checking links needs permission/);
  await show('broken');
  assert.deepEqual(listed(), ['b']);
});
