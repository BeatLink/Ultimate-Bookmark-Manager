import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, checkAll, isSkipped, isCheckable, isLoginRedirect, hasRiskyWord, credentialsFor, categorize } from '../src/lib/linkcheck.js';

const response = (status, { url, redirected = false } = {}) => ({ status, statusText: '', url, redirected, body: null });

test('skip list matches hosts and subdomains only', () => {
  assert.ok(isSkipped('https://mail.example.com/x', ['example.com']));
  assert.ok(!isSkipped('https://notexample.com/', ['example.com']));
  assert.ok(isCheckable('HTTPS://a.test') && !isCheckable('place:x'));
});

test('each check is a single GET', async () => {
  const methods = [];
  const fetchImpl = async (url, { method }) => {
    methods.push(method);
    return response(200, { url });
  };
  const r = await checkUrl('https://a.test/', { fetchImpl });
  assert.equal(r.status, 'ok');
  assert.deepEqual(methods, ['GET']);
});

test('page titles are read only when asked, and never from a login page', async () => {
  const page = (html, { url, redirected = false } = {}) => ({
    status: 200, statusText: '', url, redirected,
    headers: new Headers({ 'content-type': 'text/html' }),
    body: new Response(html).body,
  });
  const pages = {
    'https://a.test/': () => page('<title>Page A</title>', { url: 'https://a.test/' }),
    'https://b.test/': () => page('<title>https://b.test/</title>', { url: 'https://b.test/' }),
    'https://c.test/x': () => page('<title>Sign in</title>', { url: 'https://c.test/login?next=/x', redirected: true }),
  };
  const fetchImpl = async (url) => pages[url]();
  const items = Object.keys(pages).map((url) => ({ id: url, url, title: '', path: [] }));
  const results = await checkAll(items, { fetchImpl, detectLogin: true, titleFor: () => true });
  const by = Object.fromEntries(results.map((r) => [r.url, r]));
  assert.equal(by['https://a.test/'].pageTitle, 'Page A');
  assert.equal(by['https://b.test/'].pageTitle, undefined, 'a title that is just the URL is no use');
  assert.equal(by['https://c.test/x'].category, 'login');
  assert.equal(by['https://c.test/x'].pageTitle, undefined);
  const plain = await checkUrl('https://a.test/', { fetchImpl });
  assert.equal(plain.pageTitle, undefined, 'no title unless asked');
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

test('addresses on your own network are recognised, public ones are not', async () => {
  const { isPrivateAddress } = await import('../src/lib/linkcheck.js');
  for (const url of ['http://localhost:8080/', 'http://127.0.0.1/', 'http://192.168.1.1/reboot', 'http://10.0.0.5/', 'http://172.20.1.1/', 'http://169.254.1.1/',
    'http://100.64.0.1/', 'http://0x7f.1/', 'http://[::1]/', 'http://[fd12::1]/', 'http://[fe80::1]/', 'http://router/', 'http://nas.local/', 'http://printer.lan/', 'http://app.internal/']) {
    assert.ok(isPrivateAddress(url), url);
  }
  for (const url of ['https://example.com/', 'http://172.32.0.1/', 'http://192.169.0.1/', 'http://8.8.8.8/', 'http://[2001:db8::1]/', 'https://local.example.com/', 'not a url']) {
    assert.ok(!isPrivateAddress(url), url);
  }
});

test('links are checked without cookies unless asked, and never for account-changing words', async () => {
  const { credentialsFor } = await import('../src/lib/linkcheck.js');
  const { DEFAULT_SETTINGS } = await import('../src/lib/settings.js');
  assert.equal(DEFAULT_SETTINGS.linkCheck.useCookies, false);
  assert.equal(DEFAULT_SETTINGS.linkCheck.skipPrivate, true);
  assert.equal(credentialsFor('https://example.com/a', {}), 'omit');
  assert.equal(credentialsFor('https://example.com/a', { cookies: true }), 'include');
  for (const url of ['https://example.com/account/delete?id=1', 'https://example.com/email/confirm/abc', 'https://example.com/share?token=xyz', 'https://example.com/password-reset']) {
    assert.equal(credentialsFor(url, { cookies: true }), 'omit', url);
  }
});

test('text that is not a URL is never skipped, risky or a login redirect', () => {
  assert.equal(isSkipped('not a url', ['example.com']), false);
  assert.equal(hasRiskyWord('not a url', ['logout']), false);
  assert.equal(credentialsFor('not a url', { cookies: true }), 'include');
  assert.equal(isLoginRedirect('not a url', 'https://accounts.google.com/'), false);
  assert.equal(isLoginRedirect('https://a.test/', 'nowhere'), false);
});

test('blank risky words never match', () => {
  assert.equal(hasRiskyWord('https://a.test/logout', ['  ', '']), false);
  assert.equal(hasRiskyWord('https://a.test/Account/LOGOUT', [' logout ']), true);
});

test('each error status falls into its category and success has none', () => {
  assert.deepEqual([404, 410, 401, 403, 429, 503, 418, 200, 301].map(categorize), ['notFound', 'notFound', 'denied', 'denied', 'rateLimited', 'serverError', 'clientError', null, null]);
});

test('a redirect to something that is not a URL is still reported as a redirect', async () => {
  const fetchImpl = async () => response(200, { url: 'elsewhere', redirected: true });
  const r = await checkUrl('https://a.test/', { fetchImpl });
  assert.deepEqual([r.status, r.finalUrl], ['redirect', 'elsewhere']);
});

test('a redirect back to the same address, written differently, counts as no redirect', async () => {
  const fetchImpl = async () => response(200, { url: 'HTTPS://A.TEST/', redirected: true });
  const r = await checkUrl('https://a.test', { fetchImpl });
  assert.equal(r.status, 'ok');
});

test('a check that throws is reported as unreachable and the rest still run', async () => {
  const fetchImpl = async (url) => response(200, { url });
  const seen = [];
  const results = await checkAll([
    { id: '1', url: 'https://a.test/', title: 'A', path: ['M'] },
    { id: '2', url: 'https://b.test/', title: 'B', path: ['M'] },
  ], { fetchImpl, concurrency: 0, cookies: true, noCookieWords: null, onProgress: (done, total) => seen.push([done, total]) });
  assert.deepEqual(results.map((r) => [r.id, r.status, r.category, r.title]), [['1', 'broken', 'unreachable', 'A'], ['2', 'broken', 'unreachable', 'B']]);
  assert.match(results[0].detail, /TypeError/);
  assert.deepEqual(seen, [[1, 2], [2, 2]]);
});

test('cancelling a run part-way stops it and keeps the results already in', async () => {
  const ctrl = new AbortController();
  const fetchImpl = (url) => {
    if (url === 'https://a.test/') return Promise.resolve(response(200, { url }));
    ctrl.abort();
    return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  };
  const bookmarks = ['a', 'b', 'c'].map((h) => ({ id: h, url: `https://${h}.test/`, title: h, path: [] }));
  const results = await checkAll(bookmarks, { fetchImpl, concurrency: 1, signal: ctrl.signal });
  assert.deepEqual(results.map((r) => r.id), ['a']);
});
