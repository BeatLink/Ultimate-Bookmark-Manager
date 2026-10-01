import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, checkAll, isSkipped, isCheckable, isLoginRedirect, isPrivateAddress, credentialsFor, checkTargets, mergeLinkResults, fetchOptions } from '../src/lib/linkcheck.js';
import { fakeFetch } from './fake-fetch.js';

const items = (pages) => Object.keys(pages).map((url) => ({ id: url, url, title: '', path: [] }));

test('skip list matches hosts and subdomains only', () => {
  assert.ok(isSkipped('https://mail.example.com/x', ['example.com']));
  assert.ok(isSkipped('https://mail.example.com/x', ['*.example.com']));
  assert.ok(!isSkipped('https://notexample.com/', ['example.com']));
  assert.ok(isCheckable('HTTPS://a.test') && !isCheckable('place:x'));
});

test('each check is a single GET', async () => {
  const seen = [];
  const r = await checkUrl('https://a.test/', { fetchImpl: fakeFetch({ 'https://a.test/': {} }, seen) });
  assert.equal(r.status, 'ok');
  assert.deepEqual(seen.map((s) => s.method), ['GET']);
});

test('page titles are read only when asked, and never from a login page', async () => {
  const pages = {
    'https://a.test/': { html: '<title>Page A</title>' },
    'https://b.test/': { html: '<title>https://b.test/</title>' },
    'https://c.test/x': { html: '<title>Sign in</title>', finalUrl: 'https://c.test/login?next=/x' },
  };
  const fetchImpl = fakeFetch(pages);
  const results = await checkAll(items(pages), { fetchImpl, detectLogin: true, titleFor: () => true });
  const by = Object.fromEntries(results.map((r) => [r.url, r]));
  assert.equal(by['https://a.test/'].pageTitle, 'Page A');
  assert.equal(by['https://b.test/'].pageTitle, undefined, 'a title that is just the URL is no use');
  assert.equal(by['https://c.test/x'].category, 'login');
  assert.equal(by['https://c.test/x'].pageTitle, undefined);
  const plain = await checkUrl('https://a.test/', { fetchImpl });
  assert.equal(plain.pageTitle, undefined, 'no title unless asked');
});

test('statuses, redirects and network errors are categorised', async () => {
  const pages = {
    'https://gone.test/': { status: 404 },
    'https://moved.test/': { finalUrl: 'https://new.test/' },
    'https://forbidden.test/': { status: 403 },
    'https://dns.test/': () => { throw new TypeError('NetworkError'); },
  };
  const results = await checkAll(items(pages), { fetchImpl: fakeFetch(pages), concurrency: 2 });
  const by = Object.fromEntries(results.map((r) => [r.url, r]));
  assert.equal(by['https://gone.test/'].category, 'notFound');
  assert.equal(by['https://moved.test/'].status, 'redirect');
  assert.equal(by['https://moved.test/'].finalUrl, 'https://new.test/');
  assert.equal(by['https://forbidden.test/'].status, 'uncertain');
  assert.equal(by['https://dns.test/'].category, 'unreachable');
});

test('slow servers time out', async () => {
  const fetchImpl = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('a', 'AbortError'))));
  const r = await checkUrl('https://slow.test/', { fetchImpl, timeout: 20 });
  assert.equal(r.category, 'timeout');
});

test('cookies are sent only when asked, and never to URLs with account-changing words', async () => {
  assert.equal(credentialsFor('https://example.com/a', {}), 'omit');
  assert.equal(credentialsFor('https://example.com/a', { cookies: true }), 'include');
  for (const url of ['https://example.com/account/delete?id=1', 'https://example.com/email/confirm/abc', 'https://example.com/share?token=xyz', 'https://example.com/password-reset', 'https://a.test/account/LogOut']) {
    assert.equal(credentialsFor(url, { cookies: true }), 'omit', url);
  }
  const seen = [];
  await checkUrl('https://a.test/page', { fetchImpl: fakeFetch({ 'https://a.test/page': {} }, seen), cookies: true });
  assert.equal(seen[0].credentials, 'include', 'the credentials mode reaches the request');
});

test('login redirects are recognised', () => {
  const cases = [
    ['https://a.test/x', 'https://a.test/login', true],
    ['https://a.test/x', 'https://a.test/users/sign_in', true],
    ['https://a.test/x', 'https://a.test/auth.php', true],
    ['https://docs.test/d/1', 'https://accounts.google.com/ServiceLogin', true],
    ['https://app.test/d/1', 'https://corp.okta.com/app', true],
    ['https://app.test/d/1', 'https://id.test/start?return_to=https%3A%2F%2Fapp.test%2Fd%2F1', true],
    ['https://a.test/private/doc', 'https://a.test/gate?next=/private/doc', true],
    ['https://old.test/page', 'https://new.test/page', false],
    ['http://a.test/blog', 'https://a.test/blog/', false],
    ['https://a.test/x', 'https://a.test/authors/jane', false],
    ['https://a.test/', 'https://a.test/home?from=/', false],
  ];
  for (const [from, to, expected] of cases) assert.equal(isLoginRedirect(from, to), expected, `${from} → ${to}`);
});

test('login redirects are uncertain only when detection is on', async () => {
  const fetchImpl = fakeFetch({ 'https://a.test/x': { finalUrl: 'https://a.test/login?next=%2Fx' } });
  const off = await checkUrl('https://a.test/x', { fetchImpl });
  assert.equal(off.status, 'redirect');
  const on = await checkUrl('https://a.test/x', { fetchImpl, detectLogin: true });
  assert.equal(on.status, 'uncertain');
  assert.equal(on.category, 'login');
  assert.equal(on.finalUrl, 'https://a.test/login?next=%2Fx');
});

test('addresses on your own network are recognised, public ones are not', () => {
  for (const url of ['http://localhost:8080/', 'http://127.0.0.1/', 'http://192.168.1.1/reboot', 'http://10.0.0.5/', 'http://172.20.1.1/', 'http://169.254.1.1/',
    'http://100.64.0.1/', 'http://0x7f.1/', 'http://[::1]/', 'http://[fd12::1]/', 'http://[fe80::1]/', 'http://router/', 'http://nas.local/', 'http://printer.lan/', 'http://app.internal/']) {
    assert.ok(isPrivateAddress(url), url);
  }
  for (const url of ['https://example.com/', 'http://172.32.0.1/', 'http://192.169.0.1/', 'http://8.8.8.8/', 'http://[2001:db8::1]/', 'https://local.example.com/', 'not a url']) {
    assert.ok(!isPrivateAddress(url), url);
  }
});

test('a check covers checkable bookmarks that are not ignored, skipped or on your own network', () => {
  const flat = [
    { id: '1', type: 'bookmark', url: 'https://a.test/' },
    { id: '2', type: 'bookmark', url: 'https://skip.test/x' },
    { id: '3', type: 'bookmark', url: 'http://192.168.0.1/' },
    { id: '4', type: 'bookmark', url: 'place:sort=8' },
    { id: '5', type: 'bookmark', url: 'https://ignored.test/' },
    { id: '6', type: 'folder' },
  ];
  const linkCheck = { skipDomains: ['skip.test'], skipPrivate: true };
  const all = checkTargets(flat, linkCheck, new Set(['5']));
  assert.deepEqual(all.targets.map((b) => b.id), ['1']);
  assert.equal(all.skipped, 3);
  const some = checkTargets(flat, { ...linkCheck, skipPrivate: false }, new Set(['5']), new Set(['1', '3', '5']));
  assert.deepEqual(some.targets.map((b) => b.id), ['1', '3']);
  assert.equal(some.skipped, 0);
});

test('a re-check replaces only its own entries and keeps the other titles', () => {
  const previous = {
    checked: 10, skipped: 2, results: [{ id: 'a', status: 'broken' }, { id: 'b', status: 'redirect' }],
    titles: { a: { url: 'https://a.test/', title: 'A' }, c: { url: 'https://c.test/', title: 'C' } },
  };
  const results = [{ id: 'a', url: 'https://a.test/', status: 'ok', pageTitle: 'A2' }, { id: 'd', url: 'https://d.test/', status: 'broken' }];
  const partial = mergeLinkResults(previous, { results, skipped: 0, cancelled: false, wanted: new Set(['a', 'd']) });
  assert.deepEqual(partial.results.map((r) => r.id), ['b', 'd'], 'fixed links drop out, other links stay');
  assert.deepEqual(partial.titles, { c: previous.titles.c, a: { url: 'https://a.test/', title: 'A2' } });
  assert.equal(partial.checked, 10);
  assert.equal(partial.skipped, 2);
  const full = mergeLinkResults(previous, { results, skipped: 3, cancelled: true });
  assert.deepEqual(full.results.map((r) => r.id), ['d']);
  assert.deepEqual(Object.keys(full.titles), ['a']);
  assert.equal(full.checked, 2);
  assert.equal(full.skipped, 3);
  assert.equal(full.cancelled, true);
});

test('the fetch options come from the link-check settings, with the timeout in milliseconds', () => {
  const options = fetchOptions({ concurrency: 4, timeoutSeconds: 10, useCookies: true, noCookieWords: ['x'], detectLogin: false, loginHosts: ['h'] });
  assert.deepEqual(options, { concurrency: 4, timeout: 10000, cookies: true, noCookieWords: ['x'], detectLogin: false, loginHosts: ['h'] });
});
