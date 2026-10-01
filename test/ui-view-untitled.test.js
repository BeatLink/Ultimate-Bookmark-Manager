import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ReadableStream } from 'node:stream/web';
import { uninstallDom, settle } from './browser-env.js';
import { openDashboard, main, click, answer, tick, selectedCount, toasts, clearToasts, reload, ids } from './ui-view-helpers.js';

const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'u1', title: '', url: 'https://one.test/' },
    { id: 'u2', title: 'https://two.test/', url: 'https://two.test/' },
    { id: 'u3', title: '', url: 'https://three.test/' },
    { id: 'u4', title: '', url: 'https://four.test/' },
    { id: 'good', title: 'Named well', url: 'https://good.test/' },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

// Titles the last link check found: one still current, one for a URL the bookmark no longer has.
const linkResults = {
  time: Date.now(), checked: 5, skipped: 0, results: [],
  titles: { u3: { url: 'https://three.test/', title: 'Known Three' }, u4: { url: 'https://old.test/', title: 'Stale' } },
};

const pages = {
  'https://one.test/': { status: 200, html: '<html><head><title>Page One</title></head>' },
  'https://two.test/': { status: 404, html: '' },
};
const fetched = [];
let hang = false;

const browser = await openDashboard({ view: 'untitled', tree: tree(), local: { linkResults } });
after(uninstallDom);

// A fetch stand-in serving the pages above, set after the DOM installs its own; while `hang` is set it waits until the request is cancelled.
globalThis.fetch = async (url, init) => {
  fetched.push(url);
  if (hang) {
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  }
  const page = pages[url];
  const bytes = new TextEncoder().encode(page.html);
  return {
    status: page.status, statusText: '', url, redirected: false,
    headers: { get: () => 'text/html' },
    body: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
  };
};

const rowFor = (id) => main().querySelector(`input[data-sel="${id}"]`).closest('.item');
const titleOf = async (id) => (await browser.bookmarks.get(id))[0].title;

test('bookmarks with a blank or URL-only name are listed with the reason', () => {
  assert.deepEqual([...main().querySelectorAll('input[data-sel]')].map((b) => b.dataset.sel), ['u1', 'u2', 'u3', 'u4']);
  assert.equal(rowFor('u1').querySelector('.reason').textContent, 'Name is blank');
  assert.equal(rowFor('u2').querySelector('.reason').textContent, 'Name is just a URL');
  assert.equal(document.querySelector('#nav a[href="#untitled"] .badge').textContent, '4');
});

test('a title the link check found is shown only while the URL is unchanged', () => {
  assert.equal(rowFor('u3').querySelector('.found-title').textContent, 'Page title: Known Three');
  assert.equal(rowFor('u4').querySelector('.found-title'), null);
});

test('fetching a title the link check already found renames it without asking for permission', async () => {
  clearToasts();
  tick('u3');
  await click('Fetch page titles');
  assert.equal(await titleOf('u3'), 'Known Three');
  assert.equal(browser.calls.filter(([name]) => name === 'permissions.request').length, 0);
  assert.equal(fetched.length, 0);
  assert.match(toasts(), /Named 1 of 1 bookmark\(s\)\./);
  assert.equal(browser.storage.local.data.history.entries[0].label, 'Named 1 bookmark(s) from their page title');
});

test('without permission to read websites nothing is fetched', async () => {
  clearToasts();
  const request = browser.permissions.request;
  browser.permissions.request = async () => false;
  tick('u1');
  await click('Fetch page titles');
  browser.permissions.request = request;
  assert.match(toasts(), /Reading page titles needs permission to access websites\./);
  assert.equal(fetched.length, 0);
  assert.equal(await titleOf('u1'), '');
});

test('fetched pages rename their bookmarks and the rest show why they could not be named', async () => {
  clearToasts();
  tick('u1');
  tick('u2');
  await click('Fetch page titles');
  await settle(20);
  assert.deepEqual(fetched.sort(), ['https://one.test/', 'https://two.test/']);
  assert.equal(await titleOf('u1'), 'Page One');
  assert.equal(await titleOf('u2'), 'https://two.test/');
  assert.match(toasts(), /Named 1 of 2 bookmark\(s\)\. 1 could not be named; see each one for why\./);
  assert.equal(rowFor('u2').querySelector('.status').textContent, 'No title: Not found');
});

test('when no page can be named the result is reported as an error', async () => {
  clearToasts();
  fetched.length = 0;
  tick('u2');
  await click('Fetch page titles');
  await settle(20);
  assert.match(document.querySelector('#toasts .error').textContent, /Named 0 of 1 bookmark\(s\)\. 1 could not be named/);
});

test('Cancel stops a running fetch and a second press meanwhile does nothing', async () => {
  clearToasts();
  hang = true;
  tick('u4');
  assert.equal(selectedCount(), '2 selected');
  tick('u2', false);
  await click('Fetch page titles');
  await click('Fetch page titles');
  assert.equal(fetched.filter((u) => u === 'https://four.test/').length, 1);
  await click('Cancel', main().querySelector('.progress'));
  await settle(20);
  hang = false;
  assert.equal(rowFor('u4').querySelector('.status').textContent, 'No title: Cancelled');
  assert.equal(await titleOf('u4'), '');
});

test('the progress bar shows while titles load', async () => {
  hang = true;
  tick('u4');
  await click('Fetch page titles');
  const progress = main().querySelector('.progress');
  const shown = !progress.hidden;
  await click('Cancel', progress);
  await settle(20);
  hang = false;
  tick('u4', false);
  assert.equal(shown, true);
});

test('Select all ticks every listed bookmark', async () => {
  await click('Select all');
  assert.equal(selectedCount(), '2 selected');
  await click('Select all');
  assert.equal(selectedCount(), '0 selected');
});

test('ignoring a bookmark adds it to the whitelist and hides it', async () => {
  tick('u2');
  await click('Ignore');
  assert.deepEqual(browser.storage.local.data.whitelist, { u2: { title: 'https://two.test/', url: 'https://two.test/' } });
  assert.equal(main().querySelector('input[data-sel="u2"]'), null);
});

test('removing asks first and deletes only when confirmed', async () => {
  tick('u4');
  await click('Remove selected');
  assert.equal(await answer(false), 'Remove 1 bookmark(s)?');
  assert.ok((await ids(browser)).includes('u4'));
  clearToasts();
  await click('Remove selected');
  await answer(true);
  assert.equal((await ids(browser)).includes('u4'), false);
  assert.match(toasts(), /Removed 1 bookmark\(s\)\./);
  assert.equal(browser.storage.local.data.history.entries[0].label, 'Removed 1 bookmark(s) without a useful name');
});

test('with every bookmark named the page says so', async () => {
  await browser.storage.local.set({ whitelist: {} });
  await browser.bookmarks.update('u2', { title: 'Two' });
  await reload();
  assert.equal(main().querySelector('.empty-state').textContent, 'Every bookmark has a useful name.');
});
