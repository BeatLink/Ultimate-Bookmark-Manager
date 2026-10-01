import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, settle, uninstallDom } from './browser-env.js';
import { readSettings } from '../src/lib/settings.js';

installBrowser({ page: 'app.html' });
const { LinkChecker } = await import('../src/ui/link-checker.js');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  document.getElementById('toasts').replaceChildren();
});
after(uninstallDom);

const bookmark = (id, url, title = `Site ${id}`) => ({ id, type: 'bookmark', url, title, path: ['Menu'] });

// A dashboard context with the given bookmarks, whose `finished` promise resolves when a check reloads the page.
function makeCtx({ flat, ignored = [], linkResults = null, linkCheck = {} }) {
  const settings = readSettings({ linkCheck });
  let finish;
  const ctx = {
    state: { flat, settings, linkResults },
    ignoredIds: () => new Set(ignored),
    runs: 0,
    finished: new Promise((resolve) => { finish = resolve; }),
    run: async (fn) => { ctx.runs++; await fn(); finish(); },
    reload: async () => { ctx.runs++; finish(); },
  };
  return ctx;
}

// Answers each address from a table of statuses; anything else is treated as unreachable.
function stubFetch(table) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    const entry = table[url];
    if (!entry) throw new TypeError('NetworkError');
    const { status = 200, redirectTo, html } = entry;
    return {
      status, statusText: status === 404 ? 'Not Found' : '', url: redirectTo ?? url, redirected: !!redirectTo,
      headers: new Headers({ 'content-type': 'text/html' }),
      body: html ? new Response(html).body : null,
    };
  };
  return seen;
}

const saved = () => browser.storage.local.data.linkResults;
const toasts = () => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent);

test('a full check asks for permission, checks every eligible bookmark and saves the problems', async () => {
  const seen = stubFetch({
    'https://ok.test/': {},
    'https://gone.test/': { status: 404 },
    'https://old.test/': { redirectTo: 'https://new.test/' },
    'https://named.test/': { html: '<html><head><title>Found Name</title></head></html>' },
  });
  const ctx = makeCtx({
    flat: [
      bookmark('a', 'https://ok.test/'),
      bookmark('b', 'https://gone.test/'),
      bookmark('c', 'https://old.test/'),
      bookmark('d', 'https://named.test/', ''),
      bookmark('e', 'https://down.test/'),
      bookmark('skipme', 'https://skip.test/'),
      bookmark('local', 'http://192.168.1.1/'),
      bookmark('place', 'place:sort=8'),
      bookmark('ign', 'https://ignored.test/'),
      { id: 'f', type: 'folder', title: 'Folder' },
    ],
    ignored: ['ign'],
    linkCheck: { skipDomains: ['skip.test'], concurrency: 2 },
  });
  const checker = new LinkChecker(ctx);
  checker.start();
  await ctx.finished;

  assert.deepEqual(browser.calls.find(([name]) => name === 'permissions.request'), ['permissions.request', { origins: ['<all_urls>'] }]);
  assert.deepEqual(seen.map((s) => s.url).sort(), ['https://down.test/', 'https://gone.test/', 'https://named.test/', 'https://ok.test/', 'https://old.test/']);
  assert.equal(seen[0].init.credentials, 'omit');
  const result = saved();
  assert.equal(result.checked, 5);
  assert.equal(result.skipped, 3);
  assert.equal(result.cancelled, false);
  assert.equal(typeof result.time, 'number');
  assert.deepEqual(result.results.map((r) => [r.id, r.status]).sort(), [['b', 'broken'], ['c', 'redirect'], ['e', 'broken']]);
  assert.deepEqual(result.titles, { d: { url: 'https://named.test/', title: 'Found Name' } });
  assert.equal(checker.running, false);
  assert.equal(checker.done, 5);
  assert.equal(checker.total, 5);
  assert.equal(ctx.runs, 1);
  assert.deepEqual(toasts(), ['Check finished: 5 checked, 3 need attention.']);
});

test('a check without permission only says why it cannot run', async () => {
  browser.permissions.request = async () => false;
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; };
  const ctx = makeCtx({ flat: [bookmark('a', 'https://ok.test/')] });
  new LinkChecker(ctx).start();
  await settle(10);
  assert.equal(fetched, 0);
  assert.equal(ctx.runs, 0);
  assert.deepEqual(toasts(), ['Checking links needs permission to access websites.']);
  assert.equal(document.querySelector('#toasts .toast').className, 'toast error');
  browser.permissions.request = async () => true;
});

test('a re-check of some bookmarks replaces only their saved results and titles', async () => {
  stubFetch({ 'https://a.test/': {}, 'https://b.test/': { status: 404 } });
  const ctx = makeCtx({
    flat: [bookmark('a', 'https://a.test/'), bookmark('b', 'https://b.test/'), bookmark('c', 'https://c.test/')],
    linkResults: {
      checked: 40, skipped: 2,
      results: [{ id: 'a', status: 'broken' }, { id: 'z', status: 'redirect' }],
      titles: { a: { url: 'https://a.test/', title: 'Old' }, z: { url: 'https://z.test/', title: 'Zed' } },
    },
  });
  new LinkChecker(ctx).start(['a', 'b']);
  await ctx.finished;
  const result = saved();
  assert.equal(result.checked, 40);
  assert.equal(result.skipped, 2);
  assert.deepEqual(result.results.map((r) => r.id), ['z', 'b']);
  assert.deepEqual(result.titles, { z: { url: 'https://z.test/', title: 'Zed' } });
  assert.deepEqual(toasts(), ['Check finished: 2 checked, 1 need attention.']);
});

test('a re-check with nothing saved before counts only what it checked', async () => {
  stubFetch({ 'https://a.test/': {} });
  const ctx = makeCtx({ flat: [bookmark('a', 'https://a.test/'), bookmark('local', 'http://localhost/')] });
  new LinkChecker(ctx).start(['a', 'local']);
  await ctx.finished;
  assert.equal(saved().checked, 1);
  assert.equal(saved().skipped, 1);
  assert.deepEqual(saved().results, []);
  assert.deepEqual(saved().titles, {});
});

test('private addresses are checked when the setting allows it', async () => {
  const seen = stubFetch({ 'http://192.168.1.1/': {} });
  const ctx = makeCtx({ flat: [bookmark('local', 'http://192.168.1.1/')], linkCheck: { skipPrivate: false } });
  new LinkChecker(ctx).start();
  await ctx.finished;
  assert.equal(seen.length, 1);
  assert.equal(saved().skipped, 0);
});

test('progress bars follow a running check and Cancel stops it', async () => {
  let release;
  const started = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = (url, { signal }) => {
    if (url === 'https://fast.test/') return Promise.resolve({ status: 200, url, redirected: false, body: null });
    release();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  };
  const ctx = makeCtx({ flat: [bookmark('a', 'https://fast.test/'), bookmark('b', 'https://slow.test/'), bookmark('c', 'https://slower.test/')], linkCheck: { concurrency: 1 } });
  const checker = new LinkChecker(ctx);
  const bar = checker.progress();
  document.body.append(bar);
  assert.equal(bar.hidden, true);
  assert.equal(bar.querySelector('span').textContent, 'Checked 0 of 0');

  checker.start();
  await started;
  assert.equal(checker.running, true);
  assert.equal(bar.hidden, false);
  assert.equal(bar.querySelector('progress').max, 3);
  assert.equal(bar.querySelector('progress').value, 1);
  assert.equal(bar.querySelector('span').textContent, 'Checked 1 of 3');

  const late = checker.progress();
  assert.equal(late.hidden, false);
  assert.equal(late.querySelector('span').textContent, 'Checked 1 of 3');

  bar.querySelector('button').click();
  await ctx.finished;
  assert.equal(checker.running, false);
  assert.equal(checker.progress().hidden, true);
  assert.equal(saved().cancelled, true);
  assert.equal(saved().checked, 1);
  assert.deepEqual(toasts(), ['Check cancelled: 1 checked, 0 need attention.']);
  bar.remove();
});

test('a second start while a check runs is ignored', async () => {
  let requests = 0;
  const original = browser.permissions.request;
  browser.permissions.request = async () => { requests++; return true; };
  let release;
  globalThis.fetch = (url) => new Promise((resolve) => { release = () => resolve({ status: 200, url, redirected: false, body: null }); });
  const ctx = makeCtx({ flat: [bookmark('a', 'https://a.test/')] });
  const checker = new LinkChecker(ctx);
  checker.start();
  await settle(5);
  checker.start();
  assert.equal(requests, 1);
  release();
  await ctx.finished;
  browser.permissions.request = original;
});

test('a removed progress bar stops being updated, and cancelling with nothing running is harmless', async () => {
  stubFetch({ 'https://a.test/': {} });
  const ctx = makeCtx({ flat: [bookmark('a', 'https://a.test/')] });
  const checker = new LinkChecker(ctx);
  checker.cancel();
  const bar = checker.progress();
  document.body.append(bar);
  bar.remove();
  checker.start();
  await ctx.finished;
  assert.equal(bar.querySelector('span').textContent, 'Checked 0 of 0');
});
