import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom, settle } from './browser-env.js';
import { openDashboard, main, click, findButton, answer, tick, selectedCount, toasts, clearToasts, reload, ids } from './ui-view-helpers.js';

const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'gone', title: 'Gone', url: 'https://gone.test/' },
    { id: 'err', title: 'Erroring', url: 'https://err.test/' },
    { id: 'down', title: 'Down', url: 'https://down.test/' },
    { id: 'locked', title: 'Locked', url: 'https://locked.test/' },
    { id: 'moved', title: 'Moved', url: 'https://moved.test/' },
    { id: 'fine', title: 'Fine', url: 'https://fine.test/' },
    { id: 'js', title: 'Bookmarklet', url: 'javascript:void(0)' },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

const browser = await openDashboard({ view: 'broken', tree: tree() });
after(uninstallDom);

// How each site answers; changed by tests to show a page coming back.
const answers = {
  'https://gone.test/': { status: 404, statusText: 'Not Found' },
  'https://err.test/': { status: 503, statusText: '' },
  'https://down.test/': 'throw',
  'https://locked.test/': { status: 403, statusText: 'Forbidden' },
  'https://moved.test/': { status: 200, redirected: true, url: 'https://moved.test/new' },
  'https://fine.test/': { status: 200 },
};
const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(url);
  const a = answers[url];
  if (a === 'throw') throw new TypeError('NetworkError when attempting to fetch resource.');
  return { url, redirected: false, statusText: '', headers: { get: () => 'text/html' }, body: null, ...a };
};

const groupTitles = () => [...main().querySelectorAll('.group-title span')].map((s) => s.textContent);

test('before any check the page says links have not been checked', () => {
  assert.match(main().textContent, /Links have not been checked yet\./);
  assert.ok(findButton('Check all links'));
  assert.equal(main().querySelector('.selection-bar'), null);
  assert.equal(document.querySelector('#nav a[href="#broken"] .badge').textContent, '');
});

test('without permission to reach websites the check does not run', async () => {
  clearToasts();
  const request = browser.permissions.request;
  browser.permissions.request = async () => false;
  await click('Check all links');
  browser.permissions.request = request;
  assert.match(toasts(), /Checking links needs permission to access websites\./);
  assert.equal(fetched.length, 0);
});

test('checking all links lists the failures grouped by kind', async () => {
  clearToasts();
  await click('Check all links');
  await settle(30);
  assert.equal(fetched.length, 6, 'the bookmarklet is skipped');
  assert.match(toasts(), /Check finished: 6 checked, 5 need attention\./);
  assert.match(main().textContent, /Last check .*: 6 checked, 1 skipped\./);
  assert.ok(findButton('Check again'));
  assert.deepEqual(groupTitles(), [
    'Not found (404 / 410) — 1',
    'Server error (5xx) — 1',
    'Unreachable (DNS, connection or TLS error) — 1',
    'Access denied (401 / 403) — may still work when logged in — 1',
  ]);
  const status = (id) => main().querySelector(`input[data-sel="${id}"]`).closest('.item').querySelector('.status').textContent;
  assert.equal(status('gone'), '404 Not Found');
  assert.equal(status('err'), '503');
  assert.equal(status('down'), 'NetworkError when attempting to fetch resource.');
  assert.equal(main().querySelector('input[data-sel="moved"]'), null, 'redirects are on their own page');
  assert.equal(document.querySelector('#nav a[href="#broken"] .badge').textContent, '4');
  assert.equal(document.querySelector('#nav a[href="#redirects"] .badge').textContent, '1');
});

test('a group’s Select group button ticks just that group', async () => {
  const group = main().querySelectorAll('.group')[0];
  await click('Select group', group);
  assert.equal(selectedCount(), '1 selected');
  assert.ok(main().querySelector('input[data-sel="gone"]').checked);
  await click('Select group', group);
  assert.equal(selectedCount(), '0 selected');
});

test('Select all ticks every broken link', async () => {
  await click('Select all');
  assert.equal(selectedCount(), '4 selected');
  await click('Select all');
  assert.equal(selectedCount(), '0 selected');
});

test('checking selected links again re-checks only those and keeps the other results', async () => {
  answers['https://gone.test/'] = { status: 200 };
  fetched.length = 0;
  tick('gone');
  await click('Check again', main().querySelector('.selection-bar'));
  await settle(30);
  assert.deepEqual(fetched, ['https://gone.test/']);
  assert.equal(main().querySelector('input[data-sel="gone"]'), null);
  assert.equal(groupTitles().length, 3);
  const saved = browser.storage.local.data.linkResults;
  assert.equal(saved.checked, 6);
  assert.equal(saved.skipped, 1);
  assert.deepEqual(saved.results.map((r) => r.id).sort(), ['down', 'err', 'locked', 'moved']);
});

test('ignoring a broken link adds it to the whitelist', async () => {
  tick('locked');
  await click('Ignore');
  assert.deepEqual(Object.keys(browser.storage.local.data.whitelist), ['locked']);
  assert.equal(main().querySelector('input[data-sel="locked"]'), null);
});

test('removing broken links asks first and deletes only when confirmed', async () => {
  tick('err');
  await click('Remove selected');
  assert.equal(await answer(false), 'Remove 1 bookmark(s)?');
  assert.ok((await ids(browser)).includes('err'));
  clearToasts();
  await click('Remove selected');
  await answer(true);
  assert.equal((await ids(browser)).includes('err'), false);
  assert.match(toasts(), /Removed 1 bookmark\(s\)\./);
  assert.equal(browser.storage.local.data.history.entries[0].label, 'Removed 1 broken bookmark(s)');
});

test('a timed out link shows its kind, and a cancelled check says so', async () => {
  await browser.storage.local.set({ linkResults: {
    time: Date.now(), checked: 3, skipped: 0, cancelled: true,
    results: [{ id: 'down', url: 'https://down.test/', status: 'broken', category: 'timeout' }],
  } });
  await reload();
  assert.match(main().textContent, /3 checked, 0 skipped \(cancelled part-way\)\./);
  assert.equal(main().querySelector('.status').textContent, 'Timed out');
});

test('a link edited since the check drops out of the results', async () => {
  await browser.bookmarks.update('down', { url: 'https://down.test/elsewhere' });
  await reload();
  assert.equal(main().querySelector('.empty-state').textContent, 'No broken links found.');
});
