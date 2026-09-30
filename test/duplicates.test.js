import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, expandReplacement, findDuplicates, DEFAULT_MATCHING } from '../src/lib/duplicates.js';

const bm = (id, url, extra = {}) => ({ id, url, type: 'bookmark', title: id, path: ['Menu'], dateAdded: 0, ...extra });

test('exact matching keeps protocol, www, slash, query and fragment apart', () => {
  const urls = ['https://example.com/a', 'http://example.com/a', 'https://www.example.com/a', 'https://example.com/a/', 'https://example.com/a?x', 'https://example.com/a#y'];
  const keys = new Set(urls.map((u) => normalizeUrl(u, DEFAULT_MATCHING)));
  assert.equal(keys.size, urls.length);
});

test('host case always folds; loose options merge variants', () => {
  assert.equal(normalizeUrl('https://EXAMPLE.com/A'), 'https://example.com/A');
  const loose = { ignoreProtocol: true, ignoreWww: true, ignoreTrailingSlash: true, ignoreFragment: true, ignoreQuery: true, ignoreCase: true };
  const keys = new Set(['https://example.com/a', 'http://www.example.com/A/', 'https://example.com/a?x=1#y'].map((u) => normalizeUrl(u, loose)));
  assert.equal(keys.size, 1);
});

test('non-web URLs compare as written', () => {
  assert.equal(normalizeUrl('place:sort=8', { ...DEFAULT_MATCHING, ignoreQuery: true }), 'place:sort=8');
});

test('replacement templates expand tokens and case prefixes', () => {
  const ctx = { url: 'U', name: 'Menu/T', title: 'T' };
  assert.equal(expandReplacement('\\L$&', 'ABC', [], ctx), 'abc');
  assert.equal(expandReplacement('\\U$1-$2', 'x', ['a', 'b'], ctx), 'A-B');
  assert.equal(expandReplacement('$URL|$NAME|$TITLE|$$', 'x', [], ctx), 'U|Menu/T|T|$');
});

test('groups are numbered oldest first and ignore whitelisted ids', () => {
  const list = [bm('b', 'https://a.test/', { dateAdded: 5 }), bm('a', 'https://a.test/', { dateAdded: 1 }), bm('c', 'https://a.test/', { dateAdded: 9 }), bm('d', 'https://other.test/')];
  const { groups } = findDuplicates(list, { ignoredIds: new Set(['c']) });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map((i) => [i.id, i.order]), [['a', 1], ['b', 2]]);
});

test('filter rules exclude bookmarks and replace rules rewrite URLs', () => {
  const list = [bm('a', 'https://site.test/page?utm_source=x'), bm('b', 'https://site.test/page'), bm('c', 'https://skip.test/'), bm('d', 'https://skip.test/')];
  const rules = [
    { kind: 'filter', field: 'url', pattern: 'skip\\.test' },
    { kind: 'replace', pattern: '\\?utm_[^#]*', replacement: '' },
  ];
  const { groups, errors } = findDuplicates(list, { rules });
  assert.deepEqual(errors, []);
  assert.deepEqual(groups.map((g) => g.items.map((i) => i.id)), [['a', 'b']]);
});

test('invalid rules are reported, not thrown', () => {
  const { errors } = findDuplicates([], { rules: [{ kind: 'filter', pattern: '(' }] });
  assert.equal(errors.length, 1);
});
