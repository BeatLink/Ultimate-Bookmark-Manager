import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleMatches, resolveTarget, planMoves, validateRules, duplicateRule, describeRule, ruleApplies, migrateRule } from '../src/lib/organize.js';

const roots = [
  { id: 'menu________', title: 'Bookmarks Menu' },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar' },
  { id: 'unfiled_____', title: 'Other Bookmarks' },
];
const bm = (id, title, url, path = ['Bookmarks Menu']) => ({ id, title, url, type: 'bookmark', path });
// Conditions and rules are written in the old shape and converted, so every test also exercises the migration.
const cond = (op, words, extra = {}) => ({ field: 'either', op, values: words ? words.split(',') : [], caseSensitive: false, wholeWords: true, ...extra });
const rule = (id, conditions, target, extra = {}) => migrateRule({ id, name: id, enabled: true, match: 'any', conditions, target, ...extra });
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

test('targets resolve against root titles and aliases, else go under Other Bookmarks', () => {
  assert.deepEqual(resolveTarget('Bookmarks Toolbar/Dev', roots), { rootId: 'toolbar_____', path: ['Bookmarks Toolbar', 'Dev'], segments: ['Dev'] });
  assert.equal(resolveTarget('menu / A / B', roots).rootId, 'menu________');
  assert.deepEqual(resolveTarget('Reading/News', roots).path, ['Other Bookmarks', 'Reading', 'News']);
  assert.equal(resolveTarget('  ', roots), null);
});

test('equally specific matches go to the newer rule; bookmarks already in place stay', () => {
  const flat = [
    bm('a', 'Rust news', 'https://a.test'),
    bm('b', 'Rust guide', 'https://b.test', ['Other Bookmarks', 'Dev', 'Rust']),
    bm('c', 'Cooking', 'https://c.test'),
  ];
  const rules = [rule('news', [cond('contains', 'news')], 'Reading', { createdAt: 1 }), rule('dev', [cond('contains', 'rust')], 'Other Bookmarks/Dev', { createdAt: 2 })];
  const { moves } = planMoves(flat, rules, roots);
  assert.deepEqual(moves.map((m) => [m.bookmark.id, m.ruleId, m.others]), [['a', 'dev', 1]]);
});

test('the more specific match wins whatever the order or age of the rules', () => {
  const flat = [bm('a', 'Rust news', 'https://blog.rust-lang.org/2026/09/news.html')];
  const keyword = rule('kw', [cond('contains', 'rust')], 'Keyword', { createdAt: 9 });
  const domain = rule('dom', [cond('domain', 'rust-lang.org')], 'Domain', { createdAt: 1 });
  const sub = rule('sub', [cond('domain', 'blog.rust-lang.org')], 'Sub', { createdAt: 1 });
  const path = rule('path', [cond('startsWith', 'https://blog.rust-lang.org/2026/', { field: 'url' })], 'Path', { createdAt: 1 });
  const exact = rule('exact', [cond('equals', 'https://blog.rust-lang.org/2026/09/news.html', { field: 'url' })], 'Exact', { createdAt: 1 });
  const win = (...rs) => planMoves(flat, rs, roots).moves[0]?.ruleId;
  assert.equal(win(keyword, domain), 'dom', 'domain (50) beats one keyword (20)');
  assert.equal(win(domain, sub), 'sub', 'subdomain (60) beats domain (50)');
  assert.equal(win(sub, path), 'path', 'a path (100 + 10 per segment) beats a subdomain');
  assert.equal(win(path, exact, keyword), 'exact', 'an exact URL beats everything');
  const twoWords = rule('two', [cond('containsAll', 'rust,news', { field: 'title' })], 'Two', { createdAt: 1 });
  assert.equal(win(keyword, twoWords), 'two', 'two required keywords (40) beat one (20)');
});

test('only what matched counts: extra alternatives do not add specificity', () => {
  const flat = [bm('a', 'Rust tips', 'https://x.test')];
  const many = rule('many', [cond('contains', 'rust,go,zig,nim,odin')], 'Many', { createdAt: 1 });
  const one = rule('one', [cond('contains', 'rust')], 'One', { createdAt: 2 });
  const { moves } = planMoves(flat, [many, one], roots);
  assert.equal(moves[0].ruleId, 'one', 'both scored 20, so the newer rule wins');
  assert.equal(moves[0].score, 20);
});


test('invalid and disabled rules are left out of the plan', () => {
  const flat = [bm('a', 'x', 'https://a.test')];
  const rules = [rule('bad', [cond('regex', '(')], 'A'), rule('off', [cond('contains', 'x')], 'B', { enabled: false }), rule('notarget', [cond('contains', 'x')], '')];
  assert.equal(planMoves(flat, rules, roots).moves.length, 0);
  assert.deepEqual([...validateRules(rules, roots).keys()], ['bad', 'notarget']);
});

test('a keyword may contain commas, and old comma-separated lists become one condition each', () => {
  const b = bm('1', 'Smith, John — profile', 'https://a.test');
  const one = (value) => ({ ...rule('t', [], 'X'), query: { id: 'g', combinator: 'or', not: false, rules: [{ id: 'c', field: 'title', operator: 'contains', value }] } });
  assert.ok(ruleMatches(one('Smith, John'), b));
  assert.ok(!ruleMatches(one('Smith, Jane'), b));
  assert.ok(conditionMatches({ field: 'title', op: 'contains', value: 'nobody, profile' }, b));
  assert.equal(rule('t', [{ field: 'title', op: 'contains', value: 'nobody, profile' }], 'X').query.rules.length, 2);
});

test('regex conditions match when any pattern does, and each bad pattern is reported', () => {
  const b = bm('1', 'Issue 1234', 'https://a.test');
  assert.ok(conditionMatches({ field: 'title', op: 'regex', values: ['^PR', '\\d{3,4}$'] }, b));
  const bad = rule('bad', [{ field: 'title', op: 'regex', values: ['(', 'ok', '['] }], 'X');
  assert.equal(validateRules([bad], roots).get('bad').length, 2);
});

test('a duplicated rule is an independent copy with its own id', () => {
  const original = rule('orig', [cond('contains', 'rust')], 'Dev', { name: 'Rust' });
  const copy = duplicateRule(original);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.name, 'Rust (copy)');
  assert.equal(copy.target, 'Dev');
  copy.query.rules[0].value = 'go';
  assert.equal(original.query.rules[0].value, 'rust', 'editing the copy leaves the original alone');
  assert.notEqual(copy.query.id, original.query.id, 'groups get new ids too');
  assert.notEqual(copy.query.rules[0].id, original.query.rules[0].id, 'and so do conditions');
  assert.equal(duplicateRule(rule('x', [], 'A', { name: '' })).name, '', 'an unnamed rule stays unnamed');
});

test('rules are summed up in plain words', () => {
  const r = rule('r', [cond('contains', 'rust,cargo', { field: 'title' }), cond('domain', 'github.com'), cond('contains', '')], 'Dev', { match: 'all' });
  assert.equal(describeRule(r), '(title contains “rust” or title contains “cargo”) and site name is on domain “github.com”');
  assert.equal(describeRule(rule('r', [cond('startsWith', 'Doc', { caseSensitive: true })], 'X')), 'title or URL starts with “Doc” (exact case)');
  assert.equal(describeRule(rule('r', [cond('contains', '')], 'X')), 'No conditions yet');
});

const group = (match, conditions) => ({ type: 'group', match, conditions });

test('groups nest with any, all and none', () => {
  const rustNotReddit = rule('r', [
    cond('contains', 'rust', { field: 'title' }),
    group('none', [cond('domain', 'reddit.com'), cond('contains', 'meme', { field: 'title' })]),
  ], 'Dev', { match: 'all' });
  assert.ok(ruleMatches(rustNotReddit, bm('1', 'Rust book', 'https://doc.rust-lang.org/')));
  assert.ok(!ruleMatches(rustNotReddit, bm('2', 'Rust thread', 'https://www.reddit.com/r/rust')));
  assert.ok(!ruleMatches(rustNotReddit, bm('3', 'Rust meme', 'https://x.test/')));
  assert.ok(!ruleMatches(rustNotReddit, bm('4', 'Go book', 'https://go.dev/')));

  const either = rule('e', [group('all', [cond('contains', 'a', { field: 'title', wholeWords: false }), cond('contains', 'b', { field: 'title', wholeWords: false })]), cond('contains', 'z', { field: 'title', wholeWords: false })], 'X');
  assert.ok(ruleMatches(either, bm('1', 'ab', 'https://q.test')));
  assert.ok(ruleMatches(either, bm('2', 'z', 'https://q.test')));
  assert.ok(!ruleMatches(either, bm('3', 'a', 'https://q.test')));
});

test('a top-level none rule matches bookmarks that meet none of its conditions', () => {
  const r = rule('n', [cond('contains', 'work,job', { field: 'title' })], 'Personal', { match: 'none' });
  assert.ok(ruleMatches(r, bm('1', 'Holiday photos', 'https://p.test')));
  assert.ok(!ruleMatches(r, bm('2', 'Job board', 'https://p.test')));
});

test('empty groups are ignored and a rule made only of them never matches', () => {
  const r = rule('r', [group('none', [cond('contains', '')]), cond('contains', 'rust')], 'X');
  assert.ok(ruleMatches(r, bm('1', 'rust', 'https://a.test')));
  const empty = rule('e', [group('none', [cond('contains', '')])], 'X');
  assert.ok(!ruleMatches(empty, bm('1', 'anything', 'https://a.test')));
  assert.deepEqual(validateRules([empty], roots).get('e'), ['Add a condition on the title or URL; folder conditions only narrow a rule down.']);
});

test('nested groups are summed up with brackets and "not"', () => {
  const r = rule('r', [
    cond('contains', 'rust', { field: 'title' }),
    group('none', [cond('domain', 'reddit.com'), cond('contains', 'meme', { field: 'title' })]),
    group('any', [cond('contains', 'book', { field: 'title' })]),
  ], 'Dev', { match: 'all' });
  assert.equal(describeRule(r), 'title contains “rust” and not (site name is on domain “reddit.com” or title contains “meme”) and title contains “book”');
});

test('invalid regexes inside nested groups are reported', () => {
  const r = rule('r', [cond('contains', 'x'), group('all', [group('any', [{ field: 'title', op: 'regex', values: ['('] }])])], 'X');
  assert.equal(validateRules([r], roots).get('r').length, 1);
});

test('a none group always gets brackets, even with one condition', () => {
  const r = rule('r', [cond('contains', 'work')], 'X', { match: 'none' });
  assert.equal(describeRule(r), 'not (title or URL contains “work”)');
});

test('folder conditions limit which bookmarks a rule looks at', () => {
  const folder = (title, path) => ({ id: title, title, type: 'folder', path });
  const flat = [
    folder('Other Bookmarks', []),
    folder('Inbox', ['Other Bookmarks']),
    folder('Old', ['Other Bookmarks', 'Inbox']),
    bm('a', 'rust book', 'https://a.test', ['Other Bookmarks', 'Inbox']),
    bm('b', 'rust game', 'https://b.test', ['Bookmarks Menu', 'Games']),
    bm('c', 'rust old', 'https://c.test', ['Other Bookmarks', 'Inbox', 'Old']),
  ];
  const scoped = rule('s', [cond('contains', 'rust')], 'Dev', { sources: ['other/Inbox'] });
  assert.deepEqual(planMoves(flat, [scoped], roots).moves.map((m) => m.bookmark.id), ['a', 'c']);
  const shallow = rule('s', [cond('contains', 'rust')], 'Dev', { sources: ['other/Inbox'], sourceSubfolders: false });
  assert.equal(shallow.query.rules[0].operator, 'directlyInFolder');
  assert.deepEqual(planMoves(flat, [shallow], roots).moves.map((m) => m.bookmark.id), ['a']);
  assert.ok(!ruleApplies(scoped, flat[4], roots));

  // A bookmark outside the scoped rule's folders goes to another rule that matches it; the scoped rule is newer, so it wins ties.
  const fallback = rule('f', [cond('contains', 'rust')], 'Misc', { createdAt: 1 });
  scoped.createdAt = 2;
  assert.deepEqual(planMoves(flat, [scoped, fallback], roots).moves.map((m) => [m.bookmark.id, m.ruleId]), [['a', 's'], ['b', 'f'], ['c', 's']]);

  const gone = rule('g', [cond('contains', 'rust')], 'Dev', { sources: ['other/Nowhere'] });
  assert.equal(planMoves(flat, [gone], roots).moves.length, 0);
  assert.match(validateRules([gone], roots, flat).get('g')[0], /no longer exists/);
  assert.ok(!validateRules([gone], roots).has('g'), 'without the tree, folders are not checked');
  const onlyFolder = { ...rule('o', [], 'Dev'), query: { id: 'g', combinator: 'and', not: false, rules: [{ id: 'f', field: 'folder', operator: 'inFolder', value: 'other/Inbox' }] } };
  assert.match(validateRules([onlyFolder], roots).get('o')[0], /folder conditions only narrow/);
});

test('a catch-all rule takes only what no other rule matches, and only in its folders', async () => {
  const { newCatchAll } = await import('../src/lib/organize.js');
  const flat = [
    { id: 'of', type: 'folder', title: 'Other Bookmarks', path: [] },
    bm('rust', 'Rust book', 'https://a.test', ['Other Bookmarks']),
    bm('misc', 'Holiday photos', 'https://b.test', ['Other Bookmarks']),
    bm('deep', 'Old thing', 'https://c.test', ['Other Bookmarks', 'Sub']),
    bm('filed', 'Recipe', 'https://d.test', ['Bookmarks Menu']),
    bm('placed', 'Rust again', 'https://e.test', ['Other Bookmarks', 'Dev']),
  ];
  const catchAll = { ...newCatchAll(['Other Bookmarks']), id: 'c', target: 'Other Bookmarks/Inbox' };
  // Listed first on purpose: catch-alls run after the other rules whatever their position.
  const rules = [catchAll, rule('dev', [cond('contains', 'rust')], 'Other Bookmarks/Dev')];
  const { moves, problems } = planMoves(flat, rules, roots);
  assert.equal(problems.size, 0);
  assert.deepEqual(moves.map((m) => [m.bookmark.id, m.ruleId]), [['rust', 'dev'], ['misc', 'c']]);
  assert.equal(describeRule(catchAll), 'Anything no other rule matches where folder is directly in “Other Bookmarks”');
});

test('a catch-all rule needs a folder condition', async () => {
  const { newCatchAll } = await import('../src/lib/organize.js');
  const everywhere = { ...newCatchAll(), id: 'c', target: 'Inbox' };
  assert.match(validateRules([everywhere], roots).get('c')[0], /needs a folder condition/);
  assert.equal(planMoves([bm('x', 'x', 'https://x.test')], [everywhere], roots).moves.length, 0);
});



test('whole words stops keywords matching inside other words', async () => {
  const { occurrences, newCondition } = await import('../src/lib/organize.js');
  const meraki = bm('m', 'Monitoring and Managing Multiple Organizations - Cisco Meraki Documentation', 'https://documentation.meraki.com/Platform_Management/Monitoring');
  const men = (wholeWords) => rule('p', [cond('contains', 'men', { wholeWords })], 'X');
  assert.notEqual(planMoves([meraki], [men(false)], roots).moves.length, 0, 'inside a word, as before, when the option is off');
  assert.equal(planMoves([meraki], [men(true)], roots).moves.length, 0);
  assert.equal(planMoves([bm('c', 'Clothing for men', 'https://x.test')], [men(true)], roots).moves.length, 1, 'the word on its own still matches');
  const ww = (operator) => ({ operator, field: 'title', wholeWords: true });
  assert.deepEqual(occurrences(ww('contains'), 'git', 'git rebase, github, Git!'), [[0, 3], [20, 23]]);
  assert.deepEqual(occurrences(ww('contains'), 'c++', 'Learn C++ today'), [[6, 9]], 'keywords ending in symbols work');
  assert.deepEqual(occurrences(ww('contains'), 'café', 'Le café, cafés'), [[3, 7]], 'letters in any language count as word characters');
  assert.deepEqual(occurrences(ww('beginsWith'), 'git', 'github guide'), []);
  assert.deepEqual(occurrences(ww('beginsWith'), 'git', 'git guide'), [[0, 3]]);
  assert.deepEqual(occurrences(ww('endsWith'), 'news', 'BBC News'), [[4, 8]]);
  assert.equal(newCondition().wholeWords, true, 'new conditions default to whole words');
});

test('the winning rule explains what matched and where', () => {
  const b = bm('m', 'Cisco Meraki Documentation', 'https://documentation.meraki.com/x');
  // Matching inside words, the case that needed explaining.
  const r = rule('r', [cond('contains', 'men', { wholeWords: false })], 'X');
  const { moves } = planMoves([b], [r], roots);
  assert.deepEqual(moves[0].why, { terms: [{ value: 'men', on: ['title', 'url'] }], title: [[17, 20]], url: [[12, 15]] });
  const dom = rule('d', [cond('domain', 'meraki.com')], 'Y');
  assert.deepEqual(planMoves([b], [dom], roots).moves[0].why.url, [[22, 32]]);
  const all = rule('a', [cond('contains', 'cisco', { field: 'title' }), { type: 'group', match: 'none', conditions: [cond('contains', 'webex')] }], 'Z', { match: 'all' });
  assert.deepEqual(planMoves([b], [all], roots).moves[0].why.terms, [{ value: 'cisco', on: ['title'] }], 'exclusions add nothing to highlight');
});


test('conditions can look at one part of the URL', async () => {
  const { urlPart } = await import('../src/lib/organize.js');
  const url = 'https://user:pw@Docs.Example.com:8080/guide/intro?lang=en&v=2#setup';
  assert.deepEqual(urlPart(url, 'host'), { text: 'Docs.Example.com', start: 16 });
  assert.deepEqual(urlPart(url, 'path'), { text: '/guide/intro', start: 37 });
  assert.deepEqual(urlPart(url, 'query'), { text: 'lang=en&v=2', start: 50 });
  assert.deepEqual(urlPart(url, 'fragment'), { text: 'setup', start: 62 });
  assert.equal(urlPart('https://a.test/x', 'query').text, '', 'a missing part is empty');
  const b = bm('1', 'Guide', url);
  assert.ok(conditionMatches(cond('startsWith', '/guide', { field: 'path' }), b));
  assert.ok(!conditionMatches(cond('contains', 'lang', { field: 'path' }), b), 'the query is not part of the path');
  assert.ok(conditionMatches(cond('contains', 'lang', { field: 'query' }), b));
  assert.ok(conditionMatches(cond('equals', 'setup', { field: 'fragment' }), b));
  assert.ok(conditionMatches(cond('endsWith', 'example.com', { field: 'host' }), b));
  assert.ok(!conditionMatches(cond('contains', 'guide', { field: 'host' }), b));
  assert.ok(conditionMatches(cond('notContains', 'intro', { field: 'query' }), b));
  assert.equal(describeRule(rule('r', [cond('startsWith', '/guide', { field: 'path' })], 'X')), 'URL path starts with “/guide”');
});

test('query parameters match by name, or by name and value', () => {
  const b = bm('1', 'Video', 'https://www.youtube.com/watch?v=abc&list=PL9');
  assert.ok(conditionMatches(cond('param', 'list'), b));
  assert.ok(conditionMatches(cond('param', 'list=pl9'), b), 'values ignore case unless exact case is on');
  assert.ok(!conditionMatches(cond('param', 'list=pl9', { caseSensitive: true }), b));
  assert.ok(!conditionMatches(cond('param', 'lis'), b), 'the whole name has to match');
  assert.ok(!conditionMatches(cond('param', 'v=ab'), b), 'the whole value has to match');
  const { moves } = planMoves([b], [rule('p', [cond('param', 'list')], 'X')], roots);
  assert.deepEqual(moves[0].why, { terms: [{ value: 'list', on: ['query'] }], title: [], url: [[36, 44]] });
});

test('URL parts are highlighted where they sit in the URL', () => {
  const b = bm('1', 'Docs', 'https://example.com/docs/api?q=docs#docs');
  const r = rule('r', [cond('contains', 'docs', { field: 'path' })], 'X');
  const { why } = planMoves([b], [r], roots).moves[0];
  assert.deepEqual(why, { terms: [{ value: 'docs', on: ['path'] }], title: [], url: [[20, 24]] });
});

test('precise URL parts score above looser matches', () => {
  const flat = [bm('a', 'Intro', 'https://docs.example.com/guide/intro?lang=en&v=2')];
  const dom = rule('dom', [cond('domain', 'example.com')], 'Domain', { createdAt: 9 });
  const param = rule('param', [cond('param', 'lang')], 'Param', { createdAt: 9 });
  const paramValue = rule('pv', [cond('param', 'lang=en')], 'PV', { createdAt: 1 });
  const prefix = rule('prefix', [cond('startsWith', '/guide/intro', { field: 'path' })], 'Prefix', { createdAt: 9 });
  const exactPath = rule('exact', [cond('equals', '/guide/intro', { field: 'path' })], 'Exact', { createdAt: 1 });
  const exactQuery = rule('eq', [cond('equals', 'lang=en&v=2', { field: 'query' })], 'EQ', { createdAt: 1 });
  const win = (...rs) => planMoves(flat, rs, roots).moves[0]?.ruleId;
  assert.equal(win(param, dom), 'dom', 'a parameter name (30) is looser than a domain (50)');
  assert.equal(win(dom, paramValue), 'pv', 'a parameter with its value (60) beats a domain');
  assert.equal(win(paramValue, exactQuery), 'eq', 'an exact query string (80) beats one parameter');
  assert.equal(win(exactQuery, prefix), 'prefix', 'a two-segment path (120) beats an exact query');
  assert.equal(win(prefix, exactPath), 'exact', 'an exact path beats a prefix of the same depth');
});

test('the plan counts every bookmark each valid rule matches, disabled rules and ones that lose included', () => {
  const flat = [bm('a', 'Rust book', 'https://a.test'), bm('b', 'Rust video', 'https://b.test'), bm('c', 'Python', 'https://c.test'), bm('d', 'Rust ignored', 'https://d.test')];
  const rust = rule('rust', [cond('contains', 'rust')], 'Bookmarks Menu/Rust');
  const video = rule('video', [cond('contains', 'video')], 'Bookmarks Menu/Video', { priority: 1 });
  const off = rule('off', [cond('contains', 'python')], 'Bookmarks Menu/Python', { enabled: false });
  const { matches, wins, moves } = planMoves(flat, [rust, video, off], roots, new Set(['d']));
  assert.deepEqual(Object.fromEntries(matches), { rust: 2, video: 1, off: 1 });
  assert.deepEqual(Object.fromEntries(wins), { rust: 1, video: 1 });
  assert.equal(moves.length, 2);
});

test('a URL condition always outranks keyword matches, however many', async () => {
  const { formatScore } = await import('../src/lib/specificity.js');
  const flat = [bm('v', 'CCNA subnetting and routing lab guide', 'https://www.youtube.com/@NetworkChuck/videos')];
  const words = rule('words', [cond('contains', 'ccna,subnetting,routing,lab')], 'Words', { createdAt: 9 });
  const addr = (id, c) => rule(id, [c], id, { createdAt: 1 });
  const win = (...rs) => planMoves(flat, rs, roots).moves[0];
  // The case reported: a site plus path typed into "URL contains" scored 20 and lost to title keywords.
  let m = win(words, addr('sitePath', cond('contains', 'youtube.com/@NetworkChuck', { field: 'url' })));
  assert.equal(m.ruleId, 'sitePath');
  assert.equal(formatScore(m.score), 'URL 110');
  assert.match(m.ranking[1].lost, /less specific \(keywords 80 vs URL 110\)/);
  // Even a bare word looked for only in the URL outranks four title keywords.
  m = win(words, addr('addrWord', cond('contains', 'videos', { field: 'url' })));
  assert.equal(m.ruleId, 'addrWord');
  assert.equal(formatScore(m.score), 'URL 20');
  // Structured URL text scores by what it spells out.
  assert.equal(formatScore(win(addr('host', cond('contains', 'youtube.com', { field: 'host' }))).score), 'URL 50');
  assert.equal(formatScore(win(addr('path', cond('contains', '/@NetworkChuck/videos', { field: 'path' }))).score), 'URL 120');
  // Within the URL tier, more specific still wins; keywords only break ties between equal URL scores.
  const both = rule('both', [cond('domain', 'youtube.com'), cond('contains', 'ccna', { field: 'title' })], 'Both', { match: 'all', createdAt: 1 });
  m = win(both, addr('dom', cond('domain', 'youtube.com')));
  assert.equal(m.ruleId, 'both');
  assert.equal(formatScore(m.score), 'URL 50 + keywords 20');
  // A "title or URL" keyword stays a keyword condition, even when it matches in the URL.
  assert.equal(formatScore(win(rule('either', [cond('contains', 'videos')], 'E')).score), 'keywords 20');
});

test('a ranking list decides between related rules; specificity only between unrelated ones', async () => {
  const { newCatchAll } = await import('../src/lib/organize.js');
  const flat = [{ id: 'of', type: 'folder', title: 'Other Bookmarks', path: [] },
    bm('v1', 'CCNA subnetting explained', 'https://www.youtube.com/watch?v=abc', ['Other Bookmarks']),
    bm('v2', 'Lo-fi beats', 'https://www.youtube.com/watch?v=xyz', ['Other Bookmarks']),
    bm('n1', 'Random page', 'https://example.com/', ['Other Bookmarks'])];
  const yt = rule('yt', [cond('domain', 'youtube.com')], 'Bookmarks Menu/YouTube', { createdAt: 2 });
  const ccna = rule('ccna', [cond('contains', 'ccna')], 'Bookmarks Menu/Career', { createdAt: 1 });
  const inbox = { ...newCatchAll(['Other Bookmarks']), id: 'inbox', target: 'Other Bookmarks/Inbox', createdAt: 3 };
  const where = (rules) => Object.fromEntries(planMoves(flat, rules, roots).moves.map((m) => [m.bookmark.id, m.ruleId]));
  assert.deepEqual(where([ccna, yt, inbox]), { v1: 'yt', v2: 'yt', n1: 'inbox' }, 'unrelated: the URL match wins');
  assert.deepEqual(where([{ ...ccna, outranks: ['yt'] }, yt, inbox]), { v1: 'ccna', v2: 'yt', n1: 'inbox' }, 'CCNA ranks above YouTube');
  assert.deepEqual(where([ccna, yt, { ...inbox, outranks: ['yt'] }]), { v1: 'ccna', v2: 'inbox', n1: 'inbox' }, 'a list can put a catch-all above YouTube; CCNA is unrelated to it, so built-in ranking puts CCNA first');
});

test('ranking lists follow through other rules, and loops are flagged and ignored', async () => {
  const { buildOrder, eligibleToOutrank, rankCandidates } = await import('../src/lib/rule-order.js');
  const { rankingWarnings } = await import('../src/lib/organize.js');
  const a = { id: 'a', name: 'A', outranks: ['b'] };
  const b = { id: 'b', name: 'B', outranks: ['c'] };
  const c = { id: 'c', name: 'C', outranks: [] };
  const d = { id: 'd', name: 'D', outranks: [] };
  const order = buildOrder([a, b, c, d]);
  assert.ok(order.ranksAbove('a', 'c'), 'A ranks above C through B');
  assert.ok(!order.ranksAbove('c', 'a') && !order.ranksAbove('a', 'd'));
  assert.deepEqual(eligibleToOutrank(c, [a, b, c, d]).map((r) => r.id), ['d'], 'C cannot list A or B: that would make a loop');
  assert.deepEqual(eligibleToOutrank(a, [a, b, c, d]).map((r) => r.id), ['c', 'd'], 'already listed and itself are left out');
  // Rank order: related rules by the list, unrelated ones by score.
  const cand = (rule, score) => ({ rule, score, index: 0 });
  const ranked = rankCandidates([cand(c, 900), cand(d, 50), cand(a, 20), cand(b, 10)], order);
  assert.deepEqual(ranked.map((x) => x.rule.id), ['d', 'a', 'b', 'c'], 'C scores highest but A and B both rank above it');
  // A loop that slipped in (say from an import) is reported, and its links ignored.
  const loopA = { id: 'a', name: 'A', outranks: ['b'] };
  const loopB = { id: 'b', name: 'B', outranks: ['a'] };
  const loopOrder = buildOrder([loopA, loopB, c]);
  assert.ok(!loopOrder.ranksAbove('a', 'b') && !loopOrder.ranksAbove('b', 'a'));
  assert.match(rankingWarnings([loopA, loopB, c]).get('a')[0], /“A”, “B”|“B”, “A”/);
  assert.equal(rankingWarnings([a, b, c]).size, 0);
});

test('every matching rule is listed strongest first, each loser with why it lost', async () => {
  const { newCatchAll } = await import('../src/lib/organize.js');
  const { formatScore } = await import('../src/lib/specificity.js');
  const flat = [{ id: 'of', type: 'folder', title: 'Other Bookmarks', path: [] }, bm('v', 'CCNA subnetting video', 'https://www.youtube.com/watch?v=1', ['Other Bookmarks'])];
  const ccna = rule('ccna', [cond('contains', 'ccna')], 'Bookmarks Menu/Career', { createdAt: 5, name: 'CCNA', outranks: ['yt'] });
  const subnet = rule('subnet', [cond('contains', 'subnetting,video')], 'Bookmarks Menu/Networking', { createdAt: 2 });
  const video = rule('video', [cond('contains', 'video')], 'Bookmarks Menu/Videos', { createdAt: 1 });
  const yt = rule('yt', [cond('domain', 'youtube.com')], 'Bookmarks Menu/YouTube', { createdAt: 3 });
  const inbox = { ...newCatchAll(['Other Bookmarks']), id: 'inbox', target: 'Other Bookmarks/Inbox' };
  const [m] = planMoves(flat, [inbox, yt, video, ccna, subnet], roots).moves;
  assert.deepEqual(m.ranking.map((r) => [r.ruleId, formatScore(r.score), r.lost]), [
    ['subnet', 'keywords 40', null],
    ['ccna', 'keywords 20', 'less specific (keywords 20 vs keywords 40)'],
    ['yt', 'URL 50', 'ranked below “CCNA” by your rule order'],
    ['video', 'keywords 20', 'less specific (keywords 20 vs keywords 40)'],
    ['inbox', 'catch-all', 'catch-alls only take what no other rule matches'],
  ]);
});

test('retired priority numbers and fallback flags are dropped when settings load', async () => {
  const { dropRetiredRanking } = await import('../src/lib/rule-order.js');
  const out = dropRetiredRanking([{ id: 'a', priority: 3, fallback: true, outranks: ['b'] }, { id: 'b' }]);
  assert.deepEqual(out, [{ id: 'a', outranks: ['b'] }, { id: 'b' }]);
});

test('rules saved in the old shape convert to react-querybuilder groups, one keyword per condition', () => {
  const old = {
    id: 'r', name: 'Rust', enabled: true, target: 'Dev', sources: ['Other Bookmarks', 'Bookmarks Menu/Inbox'], sourceSubfolders: true, outranks: ['x'], createdAt: 5,
    match: 'all',
    conditions: [
      { field: 'title', op: 'startsWith', value: 'rust, cargo', caseSensitive: true, wholeWords: false },
      { field: 'title', op: 'domain', values: ['github.com'] },
      { field: 'title', op: 'containsAll', values: ['book', 'guide'], wholeWords: true },
      { type: 'group', match: 'none', conditions: [{ field: 'either', op: 'param', values: ['v', 'list'] }, { field: 'url', op: 'equals', values: ['https://a.test/'] }] },
      { type: 'group', match: 'any', conditions: [{ field: 'either', op: 'regex', values: ['^x'] }, { field: 'either', op: 'notContains', values: ['meme', 'joke'] }] },
    ],
  };
  const r = migrateRule(old);
  assert.deepEqual({ ...r, query: undefined }, { id: 'r', name: 'Rust', enabled: true, target: 'Dev', outranks: ['x'], createdAt: 5, query: undefined }, 'everything else is kept');
  const strip = (item) => {
    const { id, ...rest } = item;
    assert.equal(typeof id, 'string');
    return rest.rules ? { ...rest, rules: rest.rules.map(strip) } : rest;
  };
  const c = (field, operator, value, caseSensitive = false, wholeWords = false) => ({ field, operator, value, caseSensitive, wholeWords });
  assert.deepEqual(strip(r.query), {
    combinator: 'and', not: false, rules: [
      // Source folders come first, as "any of" these folders.
      { combinator: 'or', not: false, rules: [
        { field: 'folder', operator: 'inFolder', value: 'Other Bookmarks' },
        { field: 'folder', operator: 'inFolder', value: 'Bookmarks Menu/Inbox' },
      ] },
      { combinator: 'or', not: false, rules: [c('title', 'beginsWith', 'rust', true), c('title', 'beginsWith', 'cargo', true)] },
      c('host', 'onDomain', 'github.com'),
      // "Contains all of" joins an "all" group, so its keywords sit in it directly.
      c('title', 'contains', 'book', false, true),
      c('title', 'contains', 'guide', false, true),
      { combinator: 'or', not: true, rules: [c('query', 'hasParam', 'v'), c('query', 'hasParam', 'list'), c('url', '=', 'https://a.test/')] },
      { combinator: 'or', not: false, rules: [
        c('either', 'matchesRegex', '^x'),
        { combinator: 'and', not: false, rules: [c('either', 'doesNotContain', 'meme'), c('either', 'doesNotContain', 'joke')] },
      ] },
    ],
  });
  assert.equal(migrateRule(r), r, 'a converted rule is left alone');

  const catchAll = migrateRule({ id: 'c', catchAll: true, conditions: [], target: 'X', sources: ['Other Bookmarks'], sourceSubfolders: false });
  assert.deepEqual(strip(catchAll.query), { combinator: 'or', not: false, rules: [{ field: 'folder', operator: 'directlyInFolder', value: 'Other Bookmarks' }] });
  const anyWithFolder = migrateRule({ id: 'a', match: 'any', conditions: [{ field: 'title', op: 'contains', values: ['a'] }], sources: ['Other Bookmarks'] });
  assert.deepEqual(strip(anyWithFolder.query), { combinator: 'and', not: false, rules: [
    { field: 'folder', operator: 'inFolder', value: 'Other Bookmarks' },
    { combinator: 'or', not: false, rules: [c('title', 'contains', 'a')] },
  ] }, 'an "any" rule is wrapped so its folder still has to match');
});

test('a converted rule matches the same bookmarks it did before', () => {
  const b = bm('1', 'Rust book', 'https://github.com/rust-lang/book?tab=readme');
  const r = rule('r', [cond('contains', 'rust', { field: 'title' }), cond('domain', 'github.com'), { type: 'group', match: 'none', conditions: [cond('param', 'v')] }], 'Dev', { match: 'all' });
  assert.ok(ruleMatches(r, b));
  assert.ok(!ruleMatches(r, { ...b, url: 'https://github.com/x?v=1' }), 'the "none" group still rules out a query parameter');
  assert.deepEqual(planMoves([b], [r], roots).moves[0].why.terms, [{ value: 'rust', on: ['title'] }, { value: 'github.com', on: ['host'] }]);
});

test('an inverted "all" group holds unless every condition in it does', () => {
  const b = bm('1', 'Rust news', 'https://a.test');
  const notBoth = (words) => ({ ...rule('r', [], 'X'), query: { id: 'g', combinator: 'and', not: true, rules: words.map((value, i) => ({ id: `c${i}`, field: 'either', operator: 'contains', value })) } });
  assert.ok(ruleMatches(notBoth(['rust', 'python']), b));
  assert.ok(!ruleMatches(notBoth(['rust', 'news']), b));
});

test('rules can rank above or below all other rules, and links against those tiers are flagged and ignored', async () => {
  const { buildOrder, eligibleToOutrank, eligibleToRankBelow, rankCandidates, lostBecause } = await import('../src/lib/rule-order.js');
  const { rankingWarnings } = await import('../src/lib/organize.js');
  const top = { id: 't', name: 'Top', rankAll: 'above', outranks: [] };
  const top2 = { id: 't2', name: 'Top 2', rankAll: 'above', outranks: ['t'] };
  const mid = { id: 'm', name: 'Mid', outranks: [] };
  const low = { id: 'l', name: 'Low', rankAll: 'below', outranks: [] };
  const rules = [top, top2, mid, low];
  const cand = (rule, score) => ({ rule, score, index: 0 });
  const ranked = rankCandidates([cand(low, 900), cand(mid, 500), cand(top, 10), cand(top2, 5)], buildOrder(rules));
  assert.deepEqual(ranked.map((x) => x.rule.id), ['t2', 't', 'm', 'l'], 'tiers first, then links within a tier, then score');
  assert.match(lostBecause(ranked[2], ranked[0], ranked, buildOrder(rules), String), /“Top 2” ranks above all other rules/);
  assert.match(lostBecause(ranked[3], ranked[2], ranked, buildOrder(rules), String), /ranks below all other rules/);

  assert.deepEqual(eligibleToOutrank(mid, rules).map((r) => r.id), ['l'], 'a middle rule cannot rank above a top one');
  assert.deepEqual(eligibleToRankBelow(mid, rules).map((r) => r.id), ['t', 't2'], 'but it can rank below one');
  assert.deepEqual(eligibleToOutrank(top, rules).map((r) => r.id), ['m', 'l'], 'Top 2 already ranks above Top, so Top cannot list it');

  const against = { ...mid, outranks: ['t'] };
  const order = buildOrder([top, against]);
  assert.ok(!order.ranksAbove('m', 't'), 'a link against the tiers is ignored');
  assert.match(rankingWarnings([top, against]).get('m')[0], /“Mid” is set to rank above “Top”, but “Top” ranks above all other rules/);
  assert.ok(rankingWarnings([top, against]).has('t'), 'both rules show the note');
});

test('a catch-all set to rank above all other rules beats rules with conditions', async () => {
  const { newCatchAll } = await import('../src/lib/organize.js');
  const flat = [{ id: 'of', type: 'folder', title: 'Other Bookmarks', path: [] }, bm('v', 'Rust video', 'https://www.youtube.com/watch?v=1', ['Other Bookmarks'])];
  const yt = rule('yt', [cond('domain', 'youtube.com')], 'Bookmarks Menu/YouTube');
  const inbox = { ...newCatchAll(['Other Bookmarks']), id: 'inbox', target: 'Other Bookmarks/Inbox' };
  assert.equal(planMoves(flat, [yt, inbox], roots).moves[0].ruleId, 'yt');
  assert.equal(planMoves(flat, [yt, { ...inbox, rankAll: 'above' }], roots).moves[0].ruleId, 'inbox');
  assert.equal(planMoves(flat, [{ ...yt, rankAll: 'below' }, inbox], roots).moves[0].ruleId, 'inbox', 'a rule below all others loses even to a catch-all');
});
