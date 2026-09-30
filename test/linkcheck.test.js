import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, checkAll, isSkipped, isCheckable } from '../src/lib/linkcheck.js';

const response = (status, { url, redirected = false } = {}) => ({ status, statusText: '', url, redirected, body: null });

test('skip list matches hosts and subdomains only', () => {
  assert.ok(isSkipped('https://mail.example.com/x', ['example.com']));
  assert.ok(!isSkipped('https://notexample.com/', ['example.com']));
  assert.ok(isCheckable('HTTPS://a.test') && !isCheckable('place:x'));
});

test('HEAD failures fall back to GET', async () => {
  const methods = [];
  const fetchImpl = async (url, { method }) => {
    methods.push(method);
    return method === 'HEAD' ? response(405, { url }) : response(200, { url });
  };
  const r = await checkUrl('https://a.test/', { fetchImpl });
  assert.equal(r.status, 'ok');
  assert.deepEqual(methods, ['HEAD', 'GET']);
});

test('statuses, redirects and network errors are categorised', async () => {
  const table = {
    'https://gone.test/': () => response(404, { url: 'https://gone.test/' }),
    'https://moved.test/': () => response(200, { url: 'https://new.test/', redirected: true }),
    'https://login.test/': () => response(403, { url: 'https://login.test/' }),
    'https://dns.test/': () => { throw new TypeError('NetworkError'); },
  };
  const fetchImpl = async (url) => table[url]();
  const items = Object.keys(table).map((url, i) => ({ id: String(i), url, title: '', path: [] }));
  const results = await checkAll(items, { fetchImpl, concurrency: 2 });
  const by = Object.fromEntries(results.map((r) => [r.url, r]));
  assert.equal(by['https://gone.test/'].category, 'notFound');
  assert.equal(by['https://moved.test/'].status, 'redirect');
  assert.equal(by['https://moved.test/'].finalUrl, 'https://new.test/');
  assert.equal(by['https://login.test/'].status, 'uncertain');
  assert.equal(by['https://dns.test/'].category, 'unreachable');
});

test('slow servers time out', async () => {
  const fetchImpl = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('a', 'AbortError'))));
  const r = await checkUrl('https://slow.test/', { fetchImpl, timeout: 20 });
  assert.equal(r.category, 'timeout');
});
