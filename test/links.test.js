import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDroppedLinks, urlsInText, bookmarkableTabs, isValidUrl } from '../src/lib/links.js';

test('dropped links come with their titles, or the URL as the title, and bad URLs are left out', () => {
  assert.deepEqual(parseDroppedLinks('https://a.test/\nPage A\nhttps://b.test/\n', ''), [{ url: 'https://a.test/', title: 'Page A' }, { url: 'https://b.test/', title: 'https://b.test/' }]);
  assert.deepEqual(parseDroppedLinks('', '# comment\r\nhttps://c.test/\r\nnot a url'), [{ url: 'https://c.test/', title: 'https://c.test/' }]);
  assert.deepEqual(parseDroppedLinks('', undefined), []);
});

test('pasted text yields one URL per web address in it', () => {
  assert.deepEqual(urlsInText('see https://a.test/x and http://b.test, not mailto:x@y.z or ftp://c.test/'), ['https://a.test/x', 'http://b.test,', 'ftp://c.test/']);
  assert.ok(isValidUrl('https://a.test') && !isValidUrl('nope'));
});

test('tabs worth bookmarking leave out the add-on, blank pages and repeats', () => {
  const tabs = [
    { url: 'https://a.test/', title: 'A' },
    { url: 'moz-extension://me/src/ui/app.html' },
    { url: 'about:blank' },
    { url: 'https://a.test/' },
    { title: 'no url' },
    { url: 'https://b.test/' },
  ];
  assert.deepEqual(bookmarkableTabs(tabs, 'moz-extension://me/').map((t) => t.url), ['https://a.test/', 'https://b.test/']);
});
