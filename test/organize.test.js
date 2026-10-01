import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMoves, validateRules, rankingWarnings } from '../src/lib/organize.js';
import { formatScore } from '../src/lib/specificity.js';
import { roots, bm, cond, group, rule, queryRule } from './helpers.js';

const win = (flat, ...rs) => planMoves(flat, rs, roots).moves[0];

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
  assert.equal(win(flat, keyword, domain).ruleId, 'dom', 'domain (50) beats one keyword (20)');
  assert.equal(win(flat, domain, sub).ruleId, 'sub', 'subdomain (60) beats domain (50)');
  assert.equal(win(flat, sub, path).ruleId, 'path', 'a path (100 + 10 per segment) beats a subdomain');
  assert.equal(win(flat, path, exact, keyword).ruleId, 'exact', 'an exact URL beats everything');
  const twoWords = rule('two', [cond('containsAll', 'rust,news', { field: 'title' })], 'Two', { createdAt: 1 });
  assert.equal(win(flat, keyword, twoWords).ruleId, 'two', 'two required keywords (40) beat one (20)');
});

test('only what matched counts: extra alternatives do not add specificity', () => {
  const flat = [bm('a', 'Rust tips', 'https://x.test')];
  const many = rule('many', [cond('contains', 'rust,go,zig,nim,odin')], 'Many', { createdAt: 1 });
  const one = rule('one', [cond('contains', 'rust')], 'One', { createdAt: 2 });
  const m = win(flat, many, one);
  assert.equal(m.ruleId, 'one', 'both scored 20, so the newer rule wins');
  assert.equal(m.score, 20);
});

test('precise URL parts score above looser matches', () => {
  const flat = [bm('a', 'Intro', 'https://docs.example.com/guide/intro?lang=en&v=2')];
  const dom = rule('dom', [cond('domain', 'example.com')], 'Domain', { createdAt: 9 });
  const param = rule('param', [cond('param', 'lang')], 'Param', { createdAt: 9 });
  const paramValue = rule('pv', [cond('param', 'lang=en')], 'PV', { createdAt: 1 });
  const prefix = rule('prefix', [cond('startsWith', '/guide/intro', { field: 'path' })], 'Prefix', { createdAt: 9 });
  const exactPath = rule('exact', [cond('equals', '/guide/intro', { field: 'path' })], 'Exact', { createdAt: 1 });
  const exactQuery = rule('eq', [cond('equals', 'lang=en&v=2', { field: 'query' })], 'EQ', { createdAt: 1 });
  assert.equal(win(flat, param, dom).ruleId, 'dom', 'a parameter name (30) is looser than a domain (50)');
  assert.equal(win(flat, dom, paramValue).ruleId, 'pv', 'a parameter with its value (60) beats a domain');
  assert.equal(win(flat, paramValue, exactQuery).ruleId, 'eq', 'an exact query string (80) beats one parameter');
  assert.equal(win(flat, exactQuery, prefix).ruleId, 'prefix', 'a two-segment path (120) beats an exact query');
  assert.equal(win(flat, prefix, exactPath).ruleId, 'exact', 'an exact path beats a prefix of the same depth');
});

test('a site plus path typed into "URL contains" scores as a URL and beats title keywords', () => {
  const flat = [bm('v', 'CCNA subnetting and routing lab guide', 'https://www.youtube.com/@NetworkChuck/videos')];
  const words = rule('words', [cond('contains', 'ccna,subnetting,routing,lab')], 'Words', { createdAt: 9 });
  const sitePath = rule('sitePath', [cond('contains', 'youtube.com/@NetworkChuck', { field: 'url' })], 'S', { createdAt: 1 });
  const m = win(flat, words, sitePath);
  assert.equal(m.ruleId, 'sitePath');
  assert.equal(formatScore(m.score), 'URL 110');
  assert.match(m.ranking[1].lost, /less specific \(keywords 80 vs URL 110\)/);
});

test('even a bare word looked for only in the URL outranks four title keywords', () => {
  const flat = [bm('v', 'CCNA subnetting and routing lab guide', 'https://www.youtube.com/@NetworkChuck/videos')];
  const words = rule('words', [cond('contains', 'ccna,subnetting,routing,lab')], 'Words', { createdAt: 9 });
  const addrWord = rule('addrWord', [cond('contains', 'videos', { field: 'url' })], 'A', { createdAt: 1 });
  const m = win(flat, words, addrWord);
  assert.equal(m.ruleId, 'addrWord');
  assert.equal(formatScore(m.score), 'URL 20');
});

test('structured URL text scores by what it spells out', () => {
  const flat = [bm('v', 'CCNA guide', 'https://www.youtube.com/@NetworkChuck/videos')];
  assert.equal(formatScore(win(flat, rule('host', [cond('contains', 'youtube.com', { field: 'host' })], 'H')).score), 'URL 50');
  assert.equal(formatScore(win(flat, rule('path', [cond('contains', '/@NetworkChuck/videos', { field: 'path' })], 'P')).score), 'URL 120');
});

test('within the URL tier, keywords only break ties between equal URL scores', () => {
  const flat = [bm('v', 'CCNA guide', 'https://www.youtube.com/@NetworkChuck/videos')];
  const both = rule('both', [cond('domain', 'youtube.com'), cond('contains', 'ccna', { field: 'title' })], 'Both', { match: 'all', createdAt: 1 });
  const dom = rule('dom', [cond('domain', 'youtube.com')], 'D', { createdAt: 1 });
  const m = win(flat, both, dom);
  assert.equal(m.ruleId, 'both');
  assert.equal(formatScore(m.score), 'URL 50 + keywords 20');
});

test('a "title or URL" keyword stays a keyword condition, even when it matches in the URL', () => {
  const flat = [bm('v', 'CCNA guide', 'https://www.youtube.com/@NetworkChuck/videos')];
  assert.equal(formatScore(win(flat, rule('either', [cond('contains', 'videos')], 'E')).score), 'keywords 20');
});

test('invalid and disabled rules are left out of the plan', () => {
  const flat = [bm('a', 'x', 'https://a.test')];
  const rules = [rule('bad', [cond('regex', '(')], 'A'), rule('off', [cond('contains', 'x')], 'B', { enabled: false }), rule('notarget', [cond('contains', 'x')], '')];
  assert.equal(planMoves(flat, rules, roots).moves.length, 0);
  assert.deepEqual([...validateRules(rules, roots).keys()], ['bad', 'notarget']);
});

test('each bad regex pattern is reported, inside nested groups too', () => {
  const bad = rule('bad', [{ field: 'title', op: 'regex', values: ['(', 'ok', '['] }], 'X');
  assert.equal(validateRules([bad], roots).get('bad').length, 2);
  const nested = rule('r', [cond('contains', 'x'), group('all', [group('any', [{ field: 'title', op: 'regex', values: ['('] }])])], 'X');
  assert.equal(validateRules([nested], roots).get('r').length, 1);
});

test('a rule needs a condition on the title or URL', () => {
  const empty = rule('e', [group('none', [cond('contains', '')])], 'X');
  assert.deepEqual(validateRules([empty], roots).get('e'), ['Add a condition on the title or URL; folder conditions only narrow a rule down.']);
  const onlyFolder = queryRule('o', { id: 'g', combinator: 'and', not: false, rules: [{ id: 'f', field: 'folder', operator: 'inFolder', value: 'other/Inbox' }] }, 'Dev');
  assert.match(validateRules([onlyFolder], roots).get('o')[0], /folder conditions only narrow/);
  assert.equal(planMoves([bm('x', 'x', 'https://x.test', ['Other Bookmarks'])], [onlyFolder], roots).moves.length, 0);
});

const folderTree = () => {
  const folder = (title, path) => ({ id: title, title, type: 'folder', path });
  return [
    folder('Other Bookmarks', []),
    folder('Inbox', ['Other Bookmarks']),
    folder('Old', ['Other Bookmarks', 'Inbox']),
    bm('a', 'rust book', 'https://a.test', ['Other Bookmarks', 'Inbox']),
    bm('b', 'rust game', 'https://b.test', ['Bookmarks Menu', 'Games']),
    bm('c', 'rust old', 'https://c.test', ['Other Bookmarks', 'Inbox', 'Old']),
  ];
};

test('a scoped rule moves only the bookmarks in its folders', () => {
  const flat = folderTree();
  const scoped = rule('s', [cond('contains', 'rust')], 'Dev', { sources: ['other/Inbox'] });
  assert.deepEqual(planMoves(flat, [scoped], roots).moves.map((m) => m.bookmark.id), ['a', 'c']);
  const shallow = rule('s', [cond('contains', 'rust')], 'Dev', { sources: ['other/Inbox'], sourceSubfolders: false });
  assert.deepEqual(planMoves(flat, [shallow], roots).moves.map((m) => m.bookmark.id), ['a']);
});

test('a bookmark outside a scoped rule goes to another rule that matches it', () => {
  const flat = folderTree();
  const scoped = rule('s', [cond('contains', 'rust')], 'Dev', { sources: ['other/Inbox'], createdAt: 2 });
  const fallback = rule('f', [cond('contains', 'rust')], 'Misc', { createdAt: 1 });
  assert.deepEqual(planMoves(flat, [scoped, fallback], roots).moves.map((m) => [m.bookmark.id, m.ruleId]), [['a', 's'], ['b', 'f'], ['c', 's']], 'the scoped rule is newer, so it wins ties');
});

test('a rule naming a folder that does not exist is flagged, but only when the tree is given', () => {
  const flat = folderTree();
  const gone = rule('g', [cond('contains', 'rust')], 'Dev', { sources: ['other/Nowhere'] });
  assert.equal(planMoves(flat, [gone], roots).moves.length, 0);
  assert.match(validateRules([gone], roots, flat).get('g')[0], /no longer exists/);
  assert.ok(!validateRules([gone], roots).has('g'), 'without the tree, folders are not checked');
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

test('the plan lists bookmarks no enabled rule matches, leaving out ignored ones', () => {
  const flat = [bm('a', 'Rust book', 'https://a.test'), bm('b', 'Python', 'https://b.test'), bm('c', 'Cooking', 'https://c.test'), bm('d', 'Ignored', 'https://d.test'), { id: 'f', title: 'Folder', type: 'folder', path: [] }];
  const rust = rule('rust', [cond('contains', 'rust')], 'Bookmarks Menu');
  const off = rule('off', [cond('contains', 'python')], 'Bookmarks Menu/Python', { enabled: false });
  const { unmatched } = planMoves(flat, [rust, off], roots, new Set(['d']));
  assert.deepEqual(unmatched.map((b) => b.id), ['b', 'c'], 'a bookmark already in its rule folder counts as matched');
});

test('the winning rule explains what matched, and the move knows how many rules it beat', () => {
  const b = bm('m', 'Cisco Meraki Documentation', 'https://documentation.meraki.com/x');
  const r = rule('r', [cond('contains', 'men')], 'X');
  const m = win([b], r);
  assert.deepEqual(m.why, { terms: [{ value: 'men', on: ['title', 'url'] }], title: [[17, 20]], url: [[12, 15]] });
  assert.equal(m.others, 0);
});

test('a ranking list decides between related rules; specificity only between unrelated ones', () => {
  const flat = [{ id: 'of', type: 'folder', title: 'Other Bookmarks', path: [] },
    bm('v1', 'CCNA subnetting explained', 'https://www.youtube.com/watch?v=abc', ['Other Bookmarks']),
    bm('v2', 'Lo-fi beats', 'https://www.youtube.com/watch?v=xyz', ['Other Bookmarks']),
    bm('n1', 'Random page', 'https://example.com/', ['Other Bookmarks'])];
  const yt = rule('yt', [cond('domain', 'youtube.com')], 'Bookmarks Menu/YouTube', { createdAt: 2 });
  const ccna = rule('ccna', [cond('contains', 'ccna')], 'Bookmarks Menu/Career', { createdAt: 1 });
  const pages = rule('pages', [cond('contains', 'page')], 'Other Bookmarks/Inbox', { createdAt: 3 });
  const where = (rules) => Object.fromEntries(planMoves(flat, rules, roots).moves.map((m) => [m.bookmark.id, m.ruleId]));
  assert.deepEqual(where([ccna, yt, pages]), { v1: 'yt', v2: 'yt', n1: 'pages' }, 'unrelated: the URL match wins');
  assert.deepEqual(where([{ ...ccna, outranks: ['yt'] }, yt, pages]), { v1: 'ccna', v2: 'yt', n1: 'pages' }, 'CCNA ranks above YouTube');
});

test('every matching rule is listed strongest first, each loser with why it lost', () => {
  const flat = [{ id: 'of', type: 'folder', title: 'Other Bookmarks', path: [] }, bm('v', 'CCNA subnetting video', 'https://www.youtube.com/watch?v=1', ['Other Bookmarks'])];
  const ccna = rule('ccna', [cond('contains', 'ccna')], 'Bookmarks Menu/Career', { createdAt: 5, name: 'CCNA', outranks: ['yt'] });
  const subnet = rule('subnet', [cond('contains', 'subnetting,video')], 'Bookmarks Menu/Networking', { createdAt: 2 });
  const video = rule('video', [cond('contains', 'video')], 'Bookmarks Menu/Videos', { createdAt: 1 });
  const yt = rule('yt', [cond('domain', 'youtube.com')], 'Bookmarks Menu/YouTube', { createdAt: 3 });
  const m = win(flat, yt, video, ccna, subnet);
  assert.deepEqual(m.ranking.map((r) => [r.ruleId, formatScore(r.score), r.lost]), [
    ['subnet', 'keywords 40', null],
    ['ccna', 'keywords 20', 'less specific (keywords 20 vs keywords 40)'],
    ['yt', 'URL 50', 'ranked below “CCNA” by your rule order'],
    ['video', 'keywords 20', 'less specific (keywords 20 vs keywords 40)'],
  ]);
});

test('a ranking loop is flagged on every rule in it', () => {
  const loopA = { id: 'a', name: 'A', outranks: ['b'] };
  const loopB = { id: 'b', name: 'B', outranks: ['a'] };
  const c = { id: 'c', name: 'C', outranks: [] };
  assert.match(rankingWarnings([loopA, loopB, c]).get('a')[0], /“A”, “B”|“B”, “A”/);
  assert.equal(rankingWarnings([{ ...loopA }, { id: 'b', name: 'B', outranks: ['c'] }, c]).size, 0);
});

test('a link against the tiers is flagged on both rules', () => {
  const top = { id: 't', name: 'Top', rankAll: 'above', outranks: [] };
  const against = { id: 'm', name: 'Mid', outranks: ['t'] };
  assert.match(rankingWarnings([top, against]).get('m')[0], /“Mid” is set to rank above “Top”, but “Top” ranks above all other rules/);
  assert.ok(rankingWarnings([top, against]).has('t'), 'both rules show the note');
});
