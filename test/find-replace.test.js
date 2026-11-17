import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPattern, replaceIn, findReplacements } from '../src/lib/find-replace.js';

const bookmarks = [
  { id: 'a', title: 'Old blog post', url: 'http://old.example/post' },
  { id: 'b', title: 'Recipes', url: 'https://food.test/OLD' },
  { id: 'c', title: 'Untouched', url: 'https://other.test/' },
];

test('there is nothing to find while the search is empty', () => {
  assert.equal(searchPattern({ find: '' }), null);
  assert.deepEqual(findReplacements(bookmarks, { find: '', replace: 'x' }), []);
});

test('plain text is found literally and ignores case unless asked not to', () => {
  assert.deepEqual(replaceIn('a.b A.B axb', searchPattern({ find: 'a.b' }), '-'), { text: '- - axb', before: [[0, 3], [4, 7]], after: [[0, 1], [2, 3]] });
  assert.equal(replaceIn('a.b A.B', searchPattern({ find: 'a.b', caseSensitive: true }), '-').text, '- A.B');
});

test('a plain replacement is used as it is, dollar signs included', () => {
  assert.equal(replaceIn('price', searchPattern({ find: 'price' }), '$& $1').text, '$& $1');
});

test('a regex replacement expands groups, named groups and the whole match', () => {
  const pattern = searchPattern({ find: '(\\w+)@(?<site>\\w+)', regex: true });
  const result = replaceIn('me@home and you@work', pattern, '$<site>:$1 [$&]', { regex: true });
  assert.equal(result.text, 'home:me [me@home] and work:you [you@work]');
  assert.deepEqual(result.before, [[0, 7], [12, 20]]);
  assert.deepEqual(result.after, [[0, 17], [22, 41]]);
});

test('anchors and lookbehinds see the whole text, not just the match', () => {
  const start = replaceIn('http://x/http', searchPattern({ find: '^http:', regex: true }), 'https:', { regex: true });
  assert.equal(start.text, 'https://x/http');
  const behind = replaceIn('a1 b1', searchPattern({ find: '(?<=b)1', regex: true }), '2', { regex: true });
  assert.equal(behind.text, 'a1 b2');
});

test('an invalid regex throws', () => {
  assert.throws(() => searchPattern({ find: '(', regex: true }), SyntaxError);
});

test('only the chosen fields are searched and only bookmarks that change are listed', () => {
  const both = findReplacements(bookmarks, { find: 'old', replace: 'new' });
  assert.deepEqual(both.map((b) => [b.id, b.changes]), [
    ['a', { title: 'new blog post', url: 'http://new.example/post' }],
    ['b', { url: 'https://food.test/new' }],
  ]);
  assert.deepEqual(both[0].before.title, [[0, 3]]);
  assert.deepEqual(both[0].after.url, [[7, 10]]);

  assert.deepEqual(findReplacements(bookmarks, { find: 'old', replace: 'new', field: 'title' }).map((b) => b.changes), [{ title: 'new blog post' }]);
  assert.deepEqual(findReplacements(bookmarks, { find: 'old', replace: 'new', field: 'url', caseSensitive: true }).map((b) => b.id), ['a']);
  assert.deepEqual(findReplacements(bookmarks, { find: 'Recipes', replace: 'Recipes' }), [], 'a replacement that changes nothing is not listed');
});

test('a change that would leave an invalid URL is marked', () => {
  const [item] = findReplacements(bookmarks, { find: 'https://other.test/', replace: 'nowhere', field: 'url' });
  assert.equal(item.problem, 'The new URL is not a valid address');
  assert.equal(findReplacements(bookmarks, { find: 'old', replace: 'new' })[0].problem, null);
});

test('bookmarks without a name or URL are searched as empty text', () => {
  assert.deepEqual(findReplacements([{ id: 's', title: undefined, url: undefined }], { find: '^$', replace: 'x', regex: true, field: 'title' }).map((b) => b.changes), [{ title: 'x' }]);
});
