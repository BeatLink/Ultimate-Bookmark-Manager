import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLengths, mergeLengths, lengthFor, NO_LENGTH } from '../src/lib/video-lengths.js';
import { loadVideoLengths, saveVideoLengths } from '../src/lib/settings.js';
import { fakeFetch } from './fake-fetch.js';

test('each page’s video length is read, and pages without one say why', async () => {
  const pages = {
    'https://v.test/': { html: '<meta property="og:video:duration" content="61">' },
    'https://moved.test/': { html: '<meta itemprop="duration" content="PT5S">', finalUrl: 'https://new.test/' },
    'https://text.test/': { html: '<title>Just text</title>' },
    'https://gone.test/': { status: 404 },
    'https://docs.test/d/1': { html: '<title>Sign in</title>', finalUrl: 'https://accounts.google.com/ServiceLogin' },
  };
  const items = [...Object.keys(pages), 'ftp://files.test/'].map((url) => ({ id: url, url }));
  const results = await loadLengths(items, { fetchImpl: fakeFetch(pages), timeout: 200 });
  assert.deepEqual(Object.fromEntries(results), {
    'https://v.test/': { seconds: 61 },
    'https://moved.test/': { seconds: 5 },
    'https://text.test/': { error: NO_LENGTH },
    'https://gone.test/': { error: 'Not found' },
    'https://docs.test/d/1': { error: 'Redirects to a login page' },
    'ftp://files.test/': { error: 'Not a web page' },
  });
});

test('a search adds what it found, keeps old lengths it could not refresh, and forgets removed bookmarks', () => {
  const saved = { a: { url: 'https://a.test/', seconds: 10 }, gone: { url: 'https://g.test/', seconds: 3 }, c: { url: 'https://c.test/', seconds: 4 } };
  const bookmarks = [{ id: 'a', url: 'https://a.test/' }, { id: 'b', url: 'https://b.test/' }];
  const results = new Map([['a', { error: 'Timed out' }], ['b', { seconds: 20 }]]);
  assert.deepEqual(mergeLengths(saved, bookmarks, results, new Set(['a', 'b', 'c'])), {
    a: { url: 'https://a.test/', seconds: 10 },
    b: { url: 'https://b.test/', seconds: 20 },
    c: { url: 'https://c.test/', seconds: 4 },
  });
});

test('a saved length counts only while the bookmark keeps the URL it was found at', () => {
  const saved = { a: { url: 'https://a.test/', seconds: 10 } };
  assert.equal(lengthFor(saved, { id: 'a', url: 'https://a.test/' }), 10);
  assert.equal(lengthFor(saved, { id: 'a', url: 'https://other.test/' }), null);
  assert.equal(lengthFor(saved, { id: 'f' }), null);
  assert.equal(lengthFor(null, { id: 'a', url: 'https://a.test/' }), null);
});

test('lengths are kept in storage, empty until something is found', async () => {
  const data = {};
  const storage = { get: async (key) => ({ [key]: data[key] }), set: async (values) => Object.assign(data, values) };
  assert.deepEqual(await loadVideoLengths(storage), {});
  await saveVideoLengths({ a: { url: 'https://a.test/', seconds: 1 } }, storage);
  assert.deepEqual(await loadVideoLengths(storage), { a: { url: 'https://a.test/', seconds: 1 } });
});
