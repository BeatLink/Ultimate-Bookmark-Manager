import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser, fakeEvent } from './browser-env.js';
import { VisitWatcher, withLoadOutcome, withPageTitle } from '../src/lib/page-visits.js';

const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'a', title: 'Alpha', url: 'https://alpha.test/' },
    { id: 'b', title: 'https://beta.test/', url: 'https://beta.test/' },
    { id: 'c', title: '', url: 'https://beta.test/' },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [] },
];

let browser;
let watcher;
const local = () => browser.storage.local.data;

beforeEach(() => {
  browser = fakeBrowser({ tree: tree() });
  browser.webRequest = { onBeforeRequest: fakeEvent(), onCompleted: fakeEvent(), onErrorOccurred: fakeEvent() };
  browser.storage.local.data.settings = { updateOnVisit: true };
  watcher = new VisitWatcher(browser);
  watcher.watch();
});

// Fires the events of one page request from `url`, through any `redirects`, ending with `status`.
async function load(url, status, { redirects = [], tabId = 4, incognito = false, requestId = 'r1' } = {}) {
  browser.webRequest.onBeforeRequest.emit({ requestId, url, tabId });
  for (const to of redirects) browser.webRequest.onBeforeRequest.emit({ requestId, url: to, tabId });
  await Promise.all(browser.webRequest.onCompleted.emit({ requestId, url: redirects.at(-1) ?? url, statusCode: status, statusLine: `HTTP/1.1 ${status} Reason`, tabId, incognito }));
  await watcher.saving;
}

// Fires a tab finishing loading `url` and waits for what it saves.
async function finish(tab) {
  browser.tabs.onUpdated.emit(tab.id ?? 4, { status: 'complete' }, { id: 4, ...tab });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await watcher.saving;
}

// ===== Saved results =====

test('a page that loads fine changes nothing before any check has run', () => {
  assert.equal(withLoadOutcome(null, [{ id: 'a' }], { status: 'ok' }), null);
});

test('a failed load starts results marked as from no check', () => {
  const saved = withLoadOutcome(null, [{ id: 'a', title: 'Alpha' }], { url: 'u', status: 'broken', category: 'notFound' });
  assert.equal(saved.time, null);
  assert.deepEqual(saved.results, [{ url: 'u', status: 'broken', category: 'notFound', id: 'a', title: 'Alpha' }]);
});

test('a load replaces only the entries of the bookmarks it is for', () => {
  const previous = { time: 5, checked: 2, results: [{ id: 'a', status: 'broken' }, { id: 'z', status: 'redirect' }], titles: {} };
  assert.deepEqual(withLoadOutcome(previous, [{ id: 'a' }], { status: 'ok' }), { ...previous, results: [{ id: 'z', status: 'redirect' }] });
});

test('a page title is kept only for bookmarks without a useful name, and only a useful title', () => {
  const marks = [{ id: 'a', title: 'Alpha', url: 'https://a.test/' }, { id: 'c', title: '', url: 'https://a.test/' }];
  assert.deepEqual(withPageTitle(null, marks, ' Page ').titles, { c: { url: 'https://a.test/', title: 'Page' } });
  assert.equal(withPageTitle(null, marks, 'https://a.test/'), null);
  assert.equal(withPageTitle(null, [marks[0]], 'Page'), null);
});

// ===== Watching opened pages =====

test('watching starts once, and not at all without the webRequest permission', () => {
  watcher.watch();
  assert.equal(browser.webRequest.onCompleted.listeners.length, 1);
  assert.equal(browser.tabs.onUpdated.listeners.length, 1);
  const without = fakeBrowser();
  new VisitWatcher(without).watch();
  assert.equal(without.tabs.onUpdated.listeners.length, 0);
});

test('a bookmarked page that is not found is listed as broken, and taken off once it loads', async () => {
  await load('https://alpha.test/', 404);
  assert.deepEqual(local().linkResults.results.map((r) => [r.id, r.category, r.detail]), [['a', 'notFound', 'Reason']]);
  await load('https://alpha.test/', 200);
  assert.deepEqual(local().linkResults.results, []);
});

test('a redirect is listed for the bookmark it started at, and clears the bookmarks it ended at', async () => {
  browser.storage.local.data.linkResults = { time: 1, checked: 3, skipped: 0, results: [{ id: 'b', url: 'https://beta.test/', status: 'broken' }], titles: {} };
  await load('https://alpha.test/', 200, { redirects: ['https://beta.test/'] });
  assert.deepEqual(local().linkResults.results.map((r) => [r.id, r.status, r.finalUrl]), [['a', 'redirect', 'https://beta.test/']]);
  assert.equal(local().linkResults.time, 1);
});

test('a redirect to a login page is listed as uncertain', async () => {
  await load('https://alpha.test/', 200, { redirects: ['https://alpha.test/login?next=/'] });
  assert.equal(local().linkResults.results[0].category, 'login');
});

test('private windows, requests outside tabs, other pages and a turned-off setting are left alone', async () => {
  await load('https://alpha.test/', 404, { incognito: true });
  await load('https://alpha.test/', 404, { tabId: -1 });
  await load('https://elsewhere.test/', 404);
  await load('about:blank', 404);
  browser.storage.local.data.settings = { updateOnVisit: false };
  await load('https://alpha.test/', 404);
  assert.equal(local().linkResults, undefined);
});

test('a request that fails is forgotten', () => {
  browser.webRequest.onBeforeRequest.emit({ requestId: 'r9', url: 'https://alpha.test/' });
  browser.webRequest.onErrorOccurred.emit({ requestId: 'r9' });
  assert.equal(watcher.started.size, 0);
});

test('a loaded page names the bookmarks at its address that have no useful name, and saves its video length', async () => {
  browser.scripting.executeScript = async () => [{ result: 0 }, { result: 61.6 }];
  await finish({ url: 'https://beta.test/', title: 'Beta page' });
  assert.deepEqual(local().linkResults.titles, { b: { url: 'https://beta.test/', title: 'Beta page' }, c: { url: 'https://beta.test/', title: 'Beta page' } });
  assert.deepEqual(local().videoLengths, { b: { url: 'https://beta.test/', seconds: 62 }, c: { url: 'https://beta.test/', seconds: 62 } });
});

test('a loaded page without a readable video saves no length', async () => {
  browser.scripting.executeScript = async () => { throw new Error('Missing host permission'); };
  await finish({ url: 'https://alpha.test/', title: 'Alpha' });
  await finish({ url: 'https://alpha.test/' });
  delete browser.scripting;
  await finish({ url: 'https://alpha.test/' });
  assert.equal(local().videoLengths, undefined);
  assert.equal(local().linkResults, undefined);
});

test('loaded pages are ignored in private windows, while loading, when not bookmarked and when turned off', async () => {
  await finish({ url: 'https://beta.test/', title: 'Beta', incognito: true });
  await finish({ url: 'https://other.test/', title: 'Other' });
  browser.tabs.onUpdated.emit(4, { title: 'Beta' }, { id: 4, url: 'https://beta.test/', title: 'Beta' });
  browser.storage.local.data.settings = { updateOnVisit: false };
  await finish({ url: 'https://beta.test/', title: 'Beta' });
  assert.equal(local().linkResults, undefined);
  assert.deepEqual(browser.calls.filter(([n]) => n === 'scripting.executeScript'), []);
});
