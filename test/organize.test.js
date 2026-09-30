import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionMatches, ruleMatches, resolveTarget, planMoves, validateRules, duplicateRule, describeRule, ruleApplies } from '../src/lib/organize.js';

const roots = [
  { id: 'menu________', title: 'Bookmarks Menu' },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar' },
  { id: 'unfiled_____', title: 'Other Bookmarks' },
];
const bm = (id, title, url, path = ['Bookmarks Menu']) => ({ id, title, url, type: 'bookmark', path });
const cond = (op, words, extra = {}) => ({ field: 'either', op, values: words ? words.split(',') : [], caseSensitive: false, wholeWords: true, ...extra });
const rule = (id, conditions, target, extra = {}) => ({ id, name: id, enabled: true, match: 'any', conditions, target, ...extra });

test('contains matches any comma-separated word in title or address, ignoring case', () => {
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
  assert.equal(win(path, exact, keyword), 'exact', 'an exact address beats everything');
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

test('priority beats specificity, and catch-alls lose to any match unless given priority', async () => {
  const { newCatchAll } = await import('../src/lib/organize.js');
  const flat = [{ id: 'of', type: 'folder', title: 'Other Bookmarks', path: [] }, bm('a', 'Rust', 'https://doc.rust-lang.org/book/', ['Other Bookmarks'])];
  const path = rule('path', [cond('startsWith', 'https://doc.rust-lang.org/book/', { field: 'url' })], 'Path');
  const keyword = rule('kw', [cond('contains', 'rust')], 'Keyword');
  const catchAll = { ...newCatchAll(['Other Bookmarks']), id: 'ca', target: 'Other Bookmarks/Inbox' };
  assert.equal(planMoves(flat, [path, keyword, catchAll], roots).moves[0].ruleId, 'path');
  assert.equal(planMoves(flat, [path, { ...keyword, priority: 1 }, catchAll], roots).moves[0].ruleId, 'kw');
  assert.equal(planMoves(flat, [path, keyword, { ...catchAll, priority: 5 }], roots).moves[0].ruleId, 'ca');
});

test('invalid and disabled rules are left out of the plan', () => {
  const flat = [bm('a', 'x', 'https://a.test')];
  const rules = [rule('bad', [cond('regex', '(')], 'A'), rule('off', [cond('contains', 'x')], 'B', { enabled: false }), rule('notarget', [cond('contains', 'x')], '')];
  assert.equal(planMoves(flat, rules, roots).moves.length, 0);
  assert.deepEqual([...validateRules(rules, roots).keys()], ['bad', 'notarget']);
});

test('keywords may contain commas, and older comma-separated values still work', () => {
  const b = bm('1', 'Smith, John — profile', 'https://a.test');
  assert.ok(conditionMatches({ field: 'title', op: 'contains', values: ['Smith, John'] }, b));
  assert.ok(!conditionMatches({ field: 'title', op: 'contains', values: ['Smith, Jane'] }, b));
  assert.ok(conditionMatches({ field: 'title', op: 'contains', value: 'nobody, profile' }, b));
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
  copy.conditions[0].values.push('go');
  assert.deepEqual(original.conditions[0].values, ['rust'], 'editing the copy leaves the original alone');
  assert.equal(duplicateRule(rule('x', [], 'A', { name: '' })).name, '', 'an unnamed rule stays unnamed');
});

test('rules are summed up in plain words', () => {
  const r = rule('r', [cond('contains', 'rust,cargo', { field: 'title' }), cond('domain', 'github.com'), cond('contains', '')], 'Dev', { match: 'all' });
  assert.equal(describeRule(r), 'title contains any of “cargo”, “rust” and address is on domain “github.com”');
  assert.equal(describeRule(rule('r', [cond('startsWith', 'Doc', { caseSensitive: true })], 'X')), 'title or address starts with “Doc” (exact case)');
  assert.equal(describeRule(rule('r', [cond('contains', '')], 'X')), 'No conditions yet');
});

test('summaries list keywords alphabetically, ignoring case and ordering numbers by value', () => {
  const r = rule('r', [{ field: 'title', op: 'contains', values: ['zeta', 'Alpha', 'item10', 'item2', 'beta'], wholeWords: true }], 'X');
  assert.equal(describeRule(r), 'title contains any of “Alpha”, “beta”, “item2”, “item10”, “zeta”');
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
  assert.deepEqual(validateRules([empty], roots).get('e'), ['Add at least one keyword to a condition.']);
});

test('nested groups are summed up with brackets and "not"', () => {
  const r = rule('r', [
    cond('contains', 'rust', { field: 'title' }),
    group('none', [cond('domain', 'reddit.com'), cond('contains', 'meme', { field: 'title' })]),
    group('any', [cond('contains', 'book', { field: 'title' })]),
  ], 'Dev', { match: 'all' });
  assert.equal(describeRule(r), 'title contains any of “rust” and not (address is on domain “reddit.com” or title contains any of “meme”) and title contains any of “book”');
});

test('invalid regexes inside nested groups are reported', () => {
  const r = rule('r', [cond('contains', 'x'), group('all', [group('any', [{ field: 'title', op: 'regex', values: ['('] }])])], 'X');
  assert.equal(validateRules([r], roots).get('r').length, 1);
});

test('a none group always gets brackets, even with one condition', () => {
  const r = rule('r', [cond('contains', 'work')], 'X', { match: 'none' });
  assert.equal(describeRule(r), 'not (title or address contains any of “work”)');
});

test('source folders limit which bookmarks a rule looks at', () => {
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
  const shallow = { ...scoped, sourceSubfolders: false };
  assert.deepEqual(planMoves(flat, [shallow], roots).moves.map((m) => m.bookmark.id), ['a']);
  assert.ok(!ruleApplies(scoped, flat[4], roots));

  // A bookmark outside the scoped rule's folders goes to another rule that matches it; the scoped rule is newer, so it wins ties.
  const fallback = rule('f', [cond('contains', 'rust')], 'Misc', { createdAt: 1 });
  scoped.createdAt = 2;
  assert.deepEqual(planMoves(flat, [scoped, fallback], roots).moves.map((m) => [m.bookmark.id, m.ruleId]), [['a', 's'], ['b', 'f'], ['c', 's']]);

  const gone = rule('g', [cond('contains', 'rust')], 'Dev', { sources: ['other/Nowhere'] });
  assert.equal(planMoves(flat, [gone], roots).moves.length, 0);
  assert.match(validateRules([gone], roots, flat).get('g')[0], /no longer exists/);
  assert.ok(!validateRules([gone], roots).has('g'), 'without the tree, source folders are not checked');
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
  assert.equal(describeRule(catchAll), 'Anything no other rule matches');
});

test('a catch-all rule must look in a folder', async () => {
  const { newCatchAll } = await import('../src/lib/organize.js');
  const everywhere = { ...newCatchAll(), id: 'c', target: 'Inbox' };
  assert.match(validateRules([everywhere], roots).get('c')[0], /must look in at least one folder/);
  assert.equal(planMoves([bm('x', 'x', 'https://x.test')], [everywhere], roots).moves.length, 0);
});


test('a fallback rule only takes what no normal rule matches, and still beats catch-alls', async () => {
  const { newCatchAll } = await import('../src/lib/organize.js');
  const flat = [
    { id: 'of', type: 'folder', title: 'Other Bookmarks', path: [] },
    bm('v1', 'CCNA subnetting explained', 'https://www.youtube.com/watch?v=abc', ['Other Bookmarks']),
    bm('v2', 'Lo-fi beats', 'https://www.youtube.com/watch?v=xyz', ['Other Bookmarks']),
    bm('n1', 'Random page', 'https://example.com/', ['Other Bookmarks']),
  ];
  const ccna = rule('ccna', [cond('contains', 'ccna')], 'Bookmarks Menu/Career', { createdAt: 1 });
  const youtube = rule('yt', [cond('domain', 'youtube.com')], 'Bookmarks Menu/YouTube', { createdAt: 2, fallback: true });
  const inbox = { ...newCatchAll(['Other Bookmarks']), id: 'inbox', target: 'Other Bookmarks/Inbox', createdAt: 3 };
  const where = (rules) => Object.fromEntries(planMoves(flat, rules, roots).moves.map((m) => [m.bookmark.id, m.ruleId]));
  assert.deepEqual(where([ccna, youtube, inbox]), { v1: 'ccna', v2: 'yt', n1: 'inbox' }, 'the more specific domain match still loses to a normal rule');
  assert.deepEqual(where([ccna, { ...youtube, fallback: false }, inbox]), { v1: 'yt', v2: 'yt', n1: 'inbox' }, 'without the flag, domain (50) beats keyword (20)');
  assert.deepEqual(where([{ ...ccna, priority: -1 }, youtube, inbox]), { v1: 'yt', v2: 'yt', n1: 'inbox' }, 'priority still comes first');
  const plan = planMoves(flat, [ccna, youtube, inbox], roots).moves.find((m) => m.bookmark.id === 'v2');
  assert.ok(plan.fallback);
});

test('whole words stops keywords matching inside other words', async () => {
  const { occurrences, newCondition } = await import('../src/lib/organize.js');
  const meraki = bm('m', 'Monitoring and Managing Multiple Organizations - Cisco Meraki Documentation', 'https://documentation.meraki.com/Platform_Management/Monitoring');
  const men = (wholeWords) => rule('p', [cond('contains', 'men', { wholeWords })], 'X');
  assert.notEqual(planMoves([meraki], [men(false)], roots).moves.length, 0, 'inside a word, as before, when the option is off');
  assert.equal(planMoves([meraki], [men(true)], roots).moves.length, 0);
  assert.equal(planMoves([bm('c', 'Clothing for men', 'https://x.test')], [men(true)], roots).moves.length, 1, 'the word on its own still matches');
  const ww = (op) => ({ op, field: 'title', wholeWords: true });
  assert.deepEqual(occurrences(ww('contains'), 'git', 'git rebase, github, Git!'), [[0, 3], [20, 23]]);
  assert.deepEqual(occurrences(ww('contains'), 'c++', 'Learn C++ today'), [[6, 9]], 'keywords ending in symbols work');
  assert.deepEqual(occurrences(ww('contains'), 'café', 'Le café, cafés'), [[3, 7]], 'letters in any language count as word characters');
  assert.deepEqual(occurrences(ww('startsWith'), 'git', 'github guide'), []);
  assert.deepEqual(occurrences(ww('startsWith'), 'git', 'git guide'), [[0, 3]]);
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

test('every matching rule is listed strongest first, each loser with why it lost', async () => {
  const { newCatchAll } = await import('../src/lib/organize.js');
  const flat = [{ id: 'of', type: 'folder', title: 'Other Bookmarks', path: [] }, bm('v', 'CCNA subnetting video', 'https://www.youtube.com/watch?v=1', ['Other Bookmarks'])];
  const ccna = rule('ccna', [cond('contains', 'ccna')], 'Bookmarks Menu/Career', { createdAt: 5 });
  const video = rule('video', [cond('contains', 'video')], 'Bookmarks Menu/Videos', { createdAt: 1 });
  const subnet = rule('subnet', [cond('contains', 'subnetting,ccna', { match: 'any' })], 'Bookmarks Menu/Networking', { createdAt: 2 });
  const yt = rule('yt', [cond('domain', 'youtube.com')], 'Bookmarks Menu/YouTube', { fallback: true, createdAt: 3 });
  const pinned = rule('pinned', [cond('contains', 'video')], 'Bookmarks Menu/Pinned', { priority: -1, createdAt: 9 });
  const inbox = { ...newCatchAll(['Other Bookmarks']), id: 'inbox', target: 'Other Bookmarks/Inbox' };
  const [m] = planMoves(flat, [inbox, yt, video, pinned, ccna, subnet], roots).moves;
  assert.deepEqual(m.ranking.map((r) => [r.ruleId, r.score, r.lost]), [
    ['subnet', 40, null],
    ['ccna', 20, 'less specific (20 vs 40)'],
    ['video', 20, 'less specific (20 vs 40)'],
    ['yt', 50, 'fallback rules give way to normal rules'],
    ['inbox', -1, 'catch-alls only take what no other rule matches'],
    ['pinned', 20, 'lower priority (-1 vs 0)'],
  ]);
  assert.equal(m.ruleId, 'subnet');
  assert.deepEqual(m.ranking[1].why.terms, [{ value: 'ccna', on: ['title'] }]);
});

test('conditions can look at one part of the address', async () => {
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
  assert.equal(describeRule(rule('r', [cond('startsWith', '/guide', { field: 'path' })], 'X')), 'address path starts with “/guide”');
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

test('address parts are highlighted where they sit in the address', () => {
  const b = bm('1', 'Docs', 'https://example.com/docs/api?q=docs#docs');
  const r = rule('r', [cond('contains', 'docs', { field: 'path' })], 'X');
  const { why } = planMoves([b], [r], roots).moves[0];
  assert.deepEqual(why, { terms: [{ value: 'docs', on: ['path'] }], title: [], url: [[20, 24]] });
});

test('precise address parts score above looser matches', () => {
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
