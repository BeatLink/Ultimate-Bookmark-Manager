import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTitles } from '../src/lib/page-titles.js';
import { unhelpfulName, findUntitled } from '../src/lib/folders.js';

test('names that are blank or just an address are flagged', () => {
  assert.equal(unhelpfulName('', 'https://a.test/'), 'blank');
  assert.equal(unhelpfulName('   ', 'https://a.test/'), 'blank');
  assert.equal(unhelpfulName('https://a.test/page', 'https://a.test/page'), 'address');
  assert.equal(unhelpfulName('www.Example.com/Docs/', 'https://example.com/docs'), 'address');
  assert.equal(unhelpfulName('example.com/caf%C3%A9', 'https://example.com/café'), 'address');
  assert.equal(unhelpfulName('http://other.test/x', 'https://a.test/'), 'address', 'any bare web address is unhelpful');
  assert.equal(unhelpfulName('Example Docs', 'https://example.com/docs'), null);
  assert.equal(unhelpfulName('example.com', 'https://example.com/docs/page'), null, 'a site name for a deeper page is kept');
});

test('findUntitled tags each bookmark with the reason', () => {
  const flat = [
    { id: '1', type: 'bookmark', title: '', url: 'https://a.test/' },
    { id: '2', type: 'bookmark', title: 'https://b.test/', url: 'https://b.test/' },
    { id: '3', type: 'bookmark', title: 'Good', url: 'https://c.test/' },
  ];
  assert.deepEqual(findUntitled(flat).map((b) => [b.id, b.reason]), [['1', 'blank'], ['2', 'address']]);
});

// A stand-in browser where each page "loads" after a delay and then shows a title set by the table.
function fakeBrowser(pages) {
  let nextId = 1;
  const tabsById = new Map();
  const listeners = new Set();
  const windowsOpen = new Set();
  const log = { created: [], removedTabs: [], windows: [] };
  const tabs = {
    onUpdated: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
    async create({ windowId, url, active }) {
      assert.equal(active, false);
      assert.ok(windowsOpen.has(windowId), 'pages open in the helper window');
      const tab = { id: nextId++, windowId, url: 'about:blank', status: 'loading', title: '' };
      tabsById.set(tab.id, tab);
      log.created.push(url);
      const page = pages[url];
      if (page.loadAfter !== undefined) {
        setTimeout(() => {
          Object.assign(tab, { url: page.finalUrl ?? url, status: 'complete', title: page.title ?? url });
          for (const fn of [...listeners]) fn(tab.id, { status: 'complete' }, tab);
          if (page.lateTitle) setTimeout(() => { tab.title = page.lateTitle; }, 5);
        }, page.loadAfter);
      } else if (page.partialTitle) {
        tab.title = page.partialTitle;
      }
      return { ...tab };
    },
    async update(id, props) { Object.assign(tabsById.get(id), props); },
    async get(id) { return { ...tabsById.get(id) }; },
    async remove(id) { log.removedTabs.push(id); tabsById.delete(id); },
  };
  const windows = {
    async create(opts) { log.windows.push(opts); windowsOpen.add(99); return { id: 99, tabs: [{ id: 0 }] }; },
    async remove(id) { windowsOpen.delete(id); log.windowRemoved = id; },
    onRemoved: { addListener() {}, removeListener() {} },
  };
  const fetchImpl = async (url) => ({ status: pages[url].status ?? 200, url, redirected: false, body: null });
  return { tabs, windows, fetchImpl, log, tabsById };
}

test('titles are read from loaded pages, including ones set by scripts after load', async () => {
  const pages = {
    'https://a.test/': { loadAfter: 5, title: 'Page A' },
    'https://b.test/': { loadAfter: 5, title: 'https://b.test/', lateTitle: 'Set by script' },
    'https://c.test/': { loadAfter: 5, title: 'c.test' },
    'https://gone.test/': { status: 404 },
    'https://slow.test/': { partialTitle: 'Slow but titled' },
    'https://never.test/': {},
  };
  const b = fakeBrowser(pages);
  const items = Object.keys(pages).map((url, i) => ({ id: String(i), url }));
  const results = await loadTitles(items, { ...b, concurrency: 2, timeout: 60, settle: 20 });
  assert.deepEqual(Object.fromEntries([...results].map(([id, r]) => [items[id].url, r])), {
    'https://a.test/': { title: 'Page A' },
    'https://b.test/': { title: 'Set by script' },
    'https://c.test/': { error: 'Page has no title' },
    'https://gone.test/': { error: 'Not found' },
    'https://slow.test/': { title: 'Slow but titled' },
    'https://never.test/': { error: 'Timed out' },
  });
  assert.ok(!b.log.created.includes('https://gone.test/'), 'dead links are never opened');
  assert.equal(b.tabsById.size, 0, 'every opened tab is closed');
  assert.deepEqual(b.log.windows, [{ state: 'minimized', focused: false }]);
  assert.equal(b.log.windowRemoved, 99, 'the helper window is closed');
});

test('cancelling stops opening pages and still closes the window', async () => {
  const pages = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`https://p${i}.test/`, { loadAfter: 10, title: `P${i}` }]));
  const b = fakeBrowser(pages);
  const ctrl = new AbortController();
  const items = Object.keys(pages).map((url, i) => ({ id: String(i), url }));
  const results = await loadTitles(items, { ...b, concurrency: 1, timeout: 100, settle: 5, signal: ctrl.signal, onProgress: (n) => n === 2 && ctrl.abort() });
  assert.equal(results.size, 2);
  assert.equal(b.log.windowRemoved, 99);
});
