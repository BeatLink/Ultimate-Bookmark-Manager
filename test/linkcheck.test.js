import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, checkAll, isSkipped, isCheckable, isLoginRedirect } from '../src/lib/linkcheck.js';

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

test('cookies are sent only when asked, and never to risky URLs', async () => {
  const seen = {};
  const fetchImpl = async (url, { credentials }) => {
    seen[url] = credentials;
    return response(200, { url });
  };
  await checkUrl('https://a.test/page', { fetchImpl });
  assert.equal(seen['https://a.test/page'], 'omit');
  await checkUrl('https://a.test/page', { fetchImpl, cookies: true });
  assert.equal(seen['https://a.test/page'], 'include');
  await checkUrl('https://a.test/account/LogOut', { fetchImpl, cookies: true });
  assert.equal(seen['https://a.test/account/LogOut'], 'omit');
  await checkUrl('https://a.test/mail?action=unsubscribe', { fetchImpl, cookies: true });
  assert.equal(seen['https://a.test/mail?action=unsubscribe'], 'omit');
});

test('login redirects are recognised', () => {
  assert.ok(isLoginRedirect('https://a.test/x', 'https://a.test/login'));
  assert.ok(isLoginRedirect('https://a.test/x', 'https://a.test/users/sign_in'));
  assert.ok(isLoginRedirect('https://a.test/x', 'https://a.test/auth.php'));
  assert.ok(isLoginRedirect('https://docs.test/d/1', 'https://accounts.google.com/ServiceLogin'));
  assert.ok(isLoginRedirect('https://app.test/d/1', 'https://corp.okta.com/app'));
  assert.ok(isLoginRedirect('https://app.test/d/1', 'https://id.test/start?return_to=https%3A%2F%2Fapp.test%2Fd%2F1'));
  assert.ok(isLoginRedirect('https://a.test/private/doc', 'https://a.test/gate?next=/private/doc'));
  assert.ok(!isLoginRedirect('https://old.test/page', 'https://new.test/page'));
  assert.ok(!isLoginRedirect('http://a.test/blog', 'https://a.test/blog/'));
  assert.ok(!isLoginRedirect('https://a.test/x', 'https://a.test/authors/jane'));
  assert.ok(!isLoginRedirect('https://a.test/', 'https://a.test/home?from=/'));
});

test('login redirects are uncertain only when detection is on', async () => {
  const fetchImpl = async () => response(200, { url: 'https://a.test/login?next=%2Fx', redirected: true });
  const off = await checkUrl('https://a.test/x', { fetchImpl });
  assert.equal(off.status, 'redirect');
  const on = await checkUrl('https://a.test/x', { fetchImpl, detectLogin: true });
  assert.equal(on.status, 'uncertain');
  assert.equal(on.category, 'login');
  assert.equal(on.finalUrl, 'https://a.test/login?next=%2Fx');
});
