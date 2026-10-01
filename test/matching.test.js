import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleMatches, explainMatch, occurrences, urlPart, maxScore } from '../src/lib/matching.js';
import { POINTS, URL_TIER } from '../src/lib/specificity.js';
import { roots, bm, cond, group, rule, queryRule } from './helpers.js';

const conditionMatches = (c, b) => ruleMatches(rule('t', [c], 'X'), b);

test('contains matches any comma-separated word in title or URL, ignoring case', () => {
  const b = bm('1', 'Learn RUST today', 'https://example.com/x');
  assert.ok(conditionMatches(cond('contains', 'python, rust'), b));
  assert.ok(!conditionMatches(cond('contains', 'rust', { caseSensitive: true }), b));
  assert.ok(!conditionMatches(cond('contains', 'rust', { field: 'url' }), b));
});

test('operators behave as named', () => {
  const b = bm('1', 'News: world', 'https://news.bbc.co.uk/a');
  assert.ok(conditionMatches(cond('containsAll', 'news, world', { field: 'title' }), b));
  assert.ok(!conditionMatches(cond('containsAll', 'news, sport', { field: 'title' }), b));
  assert.ok(conditionMatches(cond('notContains', 'sport'), b));
  assert.ok(!conditionMatches(cond('notContains', 'bbc'), b), 'none-of must hold for both fields');
  assert.ok(conditionMatches(cond('startsWith', 'news', { field: 'title' }), b));
  assert.ok(conditionMatches(cond('endsWith', '/a', { field: 'url' }), b));
  assert.ok(conditionMatches(cond('equals', 'news: world', { field: 'title' }), b));
  assert.ok(conditionMatches(cond('domain', 'bbc.co.uk'), b));
  assert.ok(!conditionMatches(cond('domain', 'co.uk.evil'), b));
  assert.ok(conditionMatches(cond('regex', '^https://news\\.'), b));
});

test('match all needs every condition; empty conditions never match', () => {
  const b = bm('1', 'Rust book', 'https://doc.rust-lang.org/book');
  assert.ok(ruleMatches(rule('r', [cond('contains', 'rust'), cond('domain', 'github.com')], 'X'), b));
  assert.ok(!ruleMatches(rule('r', [cond('contains', 'rust'), cond('domain', 'github.com')], 'X', { match: 'all' }), b));
  assert.ok(!ruleMatches(rule('r', [cond('contains', '')], 'X'), b));
});

test('a keyword may contain commas', () => {
  const b = bm('1', 'Smith, John — profile', 'https://a.test');
  const one = (value) => queryRule('t', { id: 'g', combinator: 'or', not: false, rules: [{ id: 'c', field: 'title', operator: 'contains', value }] });
  assert.ok(ruleMatches(one('Smith, John'), b));
  assert.ok(!ruleMatches(one('Smith, Jane'), b));
  assert.ok(conditionMatches({ field: 'title', op: 'contains', value: 'nobody, profile' }, b), 'an old list still matches any of its words');
});

test('regex conditions match when any pattern does', () => {
  assert.ok(conditionMatches({ field: 'title', op: 'regex', values: ['^PR', '\\d{3,4}$'] }, bm('1', 'Issue 1234', 'https://a.test')));
});

test('groups nest with any, all and none', () => {
  const rustNotReddit = rule('r', [
    cond('contains', 'rust', { field: 'title' }),
    group('none', [cond('domain', 'reddit.com'), cond('contains', 'meme', { field: 'title' })]),
  ], 'Dev', { match: 'all' });
  assert.ok(ruleMatches(rustNotReddit, bm('1', 'Rust book', 'https://doc.rust-lang.org/')));
  assert.ok(!ruleMatches(rustNotReddit, bm('2', 'Rust thread', 'https://www.reddit.com/r/rust')));
  assert.ok(!ruleMatches(rustNotReddit, bm('3', 'Rust meme', 'https://x.test/')));
  assert.ok(!ruleMatches(rustNotReddit, bm('4', 'Go book', 'https://go.dev/')));

  const either = rule('e', [group('all', [cond('contains', 'a', { field: 'title' }), cond('contains', 'b', { field: 'title' })]), cond('contains', 'z', { field: 'title' })], 'X');
  assert.ok(ruleMatches(either, bm('1', 'ab', 'https://q.test')));
  assert.ok(ruleMatches(either, bm('2', 'z', 'https://q.test')));
  assert.ok(!ruleMatches(either, bm('3', 'a', 'https://q.test')));
});

test('a top-level none rule matches bookmarks that meet none of its conditions', () => {
  const r = rule('n', [cond('contains', 'work,job', { field: 'title' })], 'Personal', { match: 'none' });
  assert.ok(ruleMatches(r, bm('1', 'Holiday photos', 'https://p.test')));
  assert.ok(!ruleMatches(r, bm('2', 'Job board', 'https://p.test')));
});

test('an inverted "all" group holds unless every condition in it does', () => {
  const b = bm('1', 'Rust news', 'https://a.test');
  const notBoth = (words) => queryRule('r', { id: 'g', combinator: 'and', not: true, rules: words.map((value, i) => ({ id: `c${i}`, field: 'either', operator: 'contains', value })) });
  assert.ok(ruleMatches(notBoth(['rust', 'python']), b));
  assert.ok(!ruleMatches(notBoth(['rust', 'news']), b));
});

test('empty groups are ignored and a rule made only of them never matches', () => {
  const r = rule('r', [group('none', [cond('contains', '')]), cond('contains', 'rust')], 'X');
  assert.ok(ruleMatches(r, bm('1', 'rust', 'https://a.test')));
  const empty = rule('e', [group('none', [cond('contains', '')])], 'X');
  assert.ok(!ruleMatches(empty, bm('1', 'anything', 'https://a.test')));
});

test('folder conditions limit which bookmarks a rule looks at', () => {
  const scoped = rule('s', [cond('contains', 'rust')], 'Dev', { sources: ['other/Inbox'] });
  assert.ok(ruleMatches(scoped, bm('a', 'rust book', 'https://a.test', ['Other Bookmarks', 'Inbox']), roots));
  assert.ok(ruleMatches(scoped, bm('c', 'rust old', 'https://c.test', ['Other Bookmarks', 'Inbox', 'Old']), roots));
  assert.ok(!ruleMatches(scoped, bm('b', 'rust game', 'https://b.test', ['Bookmarks Menu', 'Games']), roots));
  const shallow = rule('s', [cond('contains', 'rust')], 'Dev', { sources: ['other/Inbox'], sourceSubfolders: false });
  assert.ok(ruleMatches(shallow, bm('a', 'rust book', 'https://a.test', ['Other Bookmarks', 'Inbox']), roots));
  assert.ok(!ruleMatches(shallow, bm('c', 'rust old', 'https://c.test', ['Other Bookmarks', 'Inbox', 'Old']), roots));
});

test('whole words stops keywords matching inside other words', () => {
  const meraki = bm('m', 'Monitoring and Managing Multiple Organizations - Cisco Meraki Documentation', 'https://documentation.meraki.com/Platform_Management/Monitoring');
  const men = (wholeWords) => rule('p', [cond('contains', 'men', { wholeWords })], 'X');
  assert.ok(ruleMatches(men(false), meraki), 'inside a word when the option is off');
  assert.ok(!ruleMatches(men(true), meraki));
  assert.ok(ruleMatches(men(true), bm('c', 'Clothing for men', 'https://x.test')), 'the word on its own still matches');
});

test('whole-word edges apply only where the keyword starts or ends with a letter or digit', () => {
  const ww = (operator) => ({ operator, field: 'title', wholeWords: true });
  assert.deepEqual(occurrences(ww('contains'), 'git', 'git rebase, github, Git!'), [[0, 3], [20, 23]]);
  assert.deepEqual(occurrences(ww('contains'), 'c++', 'Learn C++ today'), [[6, 9]], 'keywords ending in symbols work');
  assert.deepEqual(occurrences(ww('contains'), 'café', 'Le café, cafés'), [[3, 7]], 'letters in any language count as word characters');
  assert.deepEqual(occurrences(ww('beginsWith'), 'git', 'github guide'), []);
  assert.deepEqual(occurrences(ww('beginsWith'), 'git', 'git guide'), [[0, 3]]);
  assert.deepEqual(occurrences(ww('endsWith'), 'news', 'BBC News'), [[4, 8]]);
});

test('a match explains what matched and where', () => {
  const b = bm('m', 'Cisco Meraki Documentation', 'https://documentation.meraki.com/x');
  const r = rule('r', [cond('contains', 'men', { wholeWords: false })], 'X');
  assert.deepEqual(explainMatch(r, b, roots), { terms: [{ value: 'men', on: ['title', 'url'] }], title: [[17, 20]], url: [[12, 15]] });
  const dom = rule('d', [cond('domain', 'meraki.com')], 'Y');
  assert.deepEqual(explainMatch(dom, b, roots).url, [[22, 32]]);
  const all = rule('a', [cond('contains', 'cisco', { field: 'title' }), group('none', [cond('contains', 'webex')])], 'Z', { match: 'all' });
  assert.deepEqual(explainMatch(all, b, roots).terms, [{ value: 'cisco', on: ['title'] }], 'exclusions add nothing to highlight');
  assert.equal(explainMatch(r, bm('x', 'Nothing', 'https://a.test'), roots), null);
});

test('URLs split into their parts, each with where it starts', () => {
  const url = 'https://user:pw@Docs.Example.com:8080/guide/intro?lang=en&v=2#setup';
  assert.deepEqual(urlPart(url, 'host'), { text: 'Docs.Example.com', start: 16 });
  assert.deepEqual(urlPart(url, 'path'), { text: '/guide/intro', start: 37 });
  assert.deepEqual(urlPart(url, 'query'), { text: 'lang=en&v=2', start: 50 });
  assert.deepEqual(urlPart(url, 'fragment'), { text: 'setup', start: 62 });
  assert.equal(urlPart('https://a.test/x', 'query').text, '', 'a missing part is empty');
});

test('conditions can look at one part of the URL', () => {
  const b = bm('1', 'Guide', 'https://user:pw@Docs.Example.com:8080/guide/intro?lang=en&v=2#setup');
  assert.ok(conditionMatches(cond('startsWith', '/guide', { field: 'path' }), b));
  assert.ok(!conditionMatches(cond('contains', 'lang', { field: 'path' }), b), 'the query is not part of the path');
  assert.ok(conditionMatches(cond('contains', 'lang', { field: 'query' }), b));
  assert.ok(conditionMatches(cond('equals', 'setup', { field: 'fragment' }), b));
  assert.ok(conditionMatches(cond('endsWith', 'example.com', { field: 'host' }), b));
  assert.ok(!conditionMatches(cond('contains', 'guide', { field: 'host' }), b));
  assert.ok(conditionMatches(cond('notContains', 'intro', { field: 'query' }), b));
});

test('query parameters match by name, or by name and value', () => {
  const b = bm('1', 'Video', 'https://www.youtube.com/watch?v=abc&list=PL9');
  assert.ok(conditionMatches(cond('param', 'list'), b));
  assert.ok(conditionMatches(cond('param', 'list=pl9'), b), 'values ignore case unless exact case is on');
  assert.ok(!conditionMatches(cond('param', 'list=pl9', { caseSensitive: true }), b));
  assert.ok(!conditionMatches(cond('param', 'lis'), b), 'the whole name has to match');
  assert.ok(!conditionMatches(cond('param', 'v=ab'), b), 'the whole value has to match');
  assert.deepEqual(explainMatch(rule('p', [cond('param', 'list')], 'X'), b, roots), { terms: [{ value: 'list', on: ['query'] }], title: [], url: [[36, 44]] });
});

test('URL parts are highlighted where they sit in the URL', () => {
  const b = bm('1', 'Docs', 'https://example.com/docs/api?q=docs#docs');
  const r = rule('r', [cond('contains', 'docs', { field: 'path' })], 'X');
  assert.deepEqual(explainMatch(r, b, roots), { terms: [{ value: 'docs', on: ['path'] }], title: [], url: [[20, 24]] });
});

test('a converted rule matches the same bookmarks it did before', () => {
  const b = bm('1', 'Rust book', 'https://github.com/rust-lang/book?tab=readme');
  const r = rule('r', [cond('contains', 'rust', { field: 'title' }), cond('domain', 'github.com'), group('none', [cond('param', 'v')])], 'Dev', { match: 'all' });
  assert.ok(ruleMatches(r, b));
  assert.ok(!ruleMatches(r, { ...b, url: 'https://github.com/x?v=1' }), 'the "none" group still rules out a query parameter');
  assert.deepEqual(explainMatch(r, b, roots).terms, [{ value: 'rust', on: ['title'] }, { value: 'github.com', on: ['host'] }]);
});

test('a domain condition never matches a bookmark whose address is not a URL', () => {
  const r = rule('d', [cond('domain', 'example.com')], 'X');
  assert.ok(!ruleMatches(r, bm('1', 'example.com', 'not a url')));
  assert.ok(ruleMatches(r, bm('2', 'x', 'https://www.example.com/')));
});

test('the most a rule can score counts every condition in its best part, and nothing for folders, exclusions or negated groups', () => {
  assert.equal(maxScore(rule('w', [cond('contains', 'rust,go', { field: 'title' })], 'X')), 2 * POINTS.keyword);
  const site = rule('s', [cond('domain', 'blog.example.com'), cond('contains', 'rust')], 'X', { match: 'all' });
  assert.equal(maxScore(site), POINTS.subdomain * URL_TIER + POINTS.keyword);
  const scoped = rule('f', [cond('contains', 'rust'), cond('notContains', 'go')], 'X', { match: 'all', sources: ['Bookmarks Menu'] });
  assert.equal(maxScore(scoped), POINTS.keyword);
  assert.equal(maxScore(rule('n', [cond('contains', 'rust')], 'X', { match: 'none' })), 0);
  assert.equal(maxScore(rule('b', [cond('contains', '')], 'X')), 0);
});
