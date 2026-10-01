import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTitles } from '../src/lib/page-titles.js';
import { fakeFetch } from './fake-fetch.js';

const items = (pages) => Object.keys(pages).map((url) => ({ id: url, url }));

test('titles are read from each page’s HTML, and failures say why', async () => {
  const pages = {
    'https://a.test/': { html: '<!doctype html><head><title>Page A</title></head><body>' + 'x'.repeat(1000) },
    'https://latin.test/': { bytes: Uint8Array.from([...'<title>Caf'].map((c) => c.charCodeAt(0)).concat([0xe9], [...'</title>'].map((c) => c.charCodeAt(0)))), type: 'text/html; charset=windows-1252' },
    'https://gone.test/': { status: 404 },
    'https://docs.test/d/1': { html: '<title>Sign in - Google Accounts</title>', finalUrl: 'https://accounts.google.com/ServiceLogin?continue=https://docs.test/d/1' },
  };
  const results = await loadTitles(items(pages), { fetchImpl: fakeFetch(pages), timeout: 200 });
  assert.deepEqual(Object.fromEntries(results), {
    'https://a.test/': { title: 'Page A' },
    'https://latin.test/': { title: 'Café' },
    'https://gone.test/': { error: 'Not found' },
    'https://docs.test/d/1': { error: 'Redirects to a login page' },
  });
});

test('pages whose title is set by scripts are marked, and risky links get no cookies', async () => {
  const pages = {
    'https://app.test/': { html: '<title></title><script>document.title = "App"</script>' },
    'https://app.test/logout': { html: '<title>Signed out</title>' },
  };
  const seen = [];
  const results = await loadTitles(items(pages), { fetchImpl: fakeFetch(pages, seen), cookies: true, timeout: 200 });
  assert.deepEqual(results.get('https://app.test/'), { error: 'Title is set by scripts or missing' });
  assert.deepEqual(results.get('https://app.test/logout'), { title: 'Signed out' });
  assert.deepEqual(Object.fromEntries(seen.map((r) => [r.url, r.credentials])), { 'https://app.test/': 'include', 'https://app.test/logout': 'omit' });
});

test('cancelling stops reading further pages', async () => {
  const pages = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`https://p${i}.test/`, { html: `<title>P${i}</title>` }]));
  const ctrl = new AbortController();
  const results = await loadTitles(items(pages), { fetchImpl: fakeFetch(pages), concurrency: 1, timeout: 200, signal: ctrl.signal, onProgress: (n) => n === 2 && ctrl.abort() });
  assert.equal(results.size, 2);
});

test('a page whose check throws is reported as not loaded, or as cancelled once the run is stopped', async () => {
  const broken = await loadTitles([{ id: 'x', url: 'https://x.test/' }], { fetchImpl: fakeFetch({ 'https://x.test/': { html: '<title>X</title>' } }), cookies: true, noCookieWords: null });
  assert.deepEqual(broken.get('x'), { error: 'Could not load the page' });
  const ctrl = new AbortController();
  const fetchImpl = async () => {
    ctrl.abort();
    throw new Error('stopped');
  };
  const items = [{ id: 'a', url: 'https://a.test/' }, { id: 'b', url: 'https://b.test/' }];
  const cancelled = await loadTitles(items, { fetchImpl, signal: ctrl.signal, concurrency: 1 });
  assert.deepEqual([...cancelled], [['a', { error: 'Cancelled' }]]);
});
