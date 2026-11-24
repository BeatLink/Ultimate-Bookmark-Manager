import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRules, validateRules, knownPages, hasEffect } from '../src/lib/rule-plan.js';
import { newAction } from '../src/lib/rules.js';
import { roots, bm, cond, group, rule, queryRule } from './helpers.js';

const plan = (flat, rules, options) => planRules(flat, rules, roots, options);
const action = (type, extra = {}) => ({ ...newAction(type), ...extra });
const withActions = (r, ...actions) => ({ ...r, actions });

// ====
// Checking rules
// ====

test('invalid and disabled rules are left out of the plan', () => {
  const flat = [bm('a', 'x', 'https://a.test')];
  const rules = [rule('bad', [cond('regex', '(')], 'A'), rule('off', [cond('contains', 'x')], 'B', { enabled: false }), rule('notarget', [cond('contains', 'x')], '')];
  assert.equal(plan(flat, rules).changes.length, 0);
  assert.deepEqual([...validateRules(rules, roots).keys()], ['bad', 'notarget']);
});

test('each bad regex pattern is reported, inside nested groups and replace actions too', () => {
  const bad = rule('bad', [{ field: 'title', op: 'regex', values: ['(', 'ok', '['] }], 'X');
  assert.equal(validateRules([bad], roots).get('bad').length, 2);
  const nested = rule('r', [cond('contains', 'x'), group('all', [group('any', [{ field: 'title', op: 'regex', values: ['('] }])])], 'X');
  assert.equal(validateRules([nested], roots).get('r').length, 1);
  const replace = withActions(rule('p', [cond('contains', 'x')], 'X'), action('replace', { find: '[', regex: true }), action('replace', { find: '[' }));
  assert.match(validateRules([replace], roots).get('p').join(), /Invalid regex “\[”/);
  assert.equal(validateRules([replace], roots).get('p').length, 1, 'a plain search may hold any character');
});

test('a rule needs a condition, an action, a folder to move to and text to find', () => {
  const empty = rule('e', [group('none', [cond('contains', '')])], 'X');
  assert.deepEqual(validateRules([empty], roots).get('e'), ['Add a condition; a rule without one matches nothing.']);
  const none = withActions(rule('n', [cond('contains', 'x')], 'X'));
  assert.deepEqual(validateRules([none], roots).get('n'), ['Add an action.']);
  const blank = withActions(rule('b', [cond('contains', 'x')], 'X'), action('replace'));
  assert.deepEqual(validateRules([blank], roots).get('b'), ['Type the text to find and replace.']);
  const onlyFolder = queryRule('o', { id: 'g', combinator: 'and', not: false, rules: [{ id: 'f', field: 'folder', operator: 'inFolder', value: 'other/Inbox' }] }, 'Dev');
  assert.ok(!validateRules([onlyFolder], roots).has('o'), 'a folder condition alone is enough');
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

test('a rule naming a folder that does not exist is flagged, but only when the tree is given', () => {
  const flat = folderTree();
  const gone = rule('g', [cond('contains', 'rust')], 'Dev', { sources: ['other/Nowhere'] });
  assert.equal(plan(flat, [gone]).changes.length, 0);
  assert.match(validateRules([gone], roots, flat).get('g')[0], /no longer exists/);
  assert.ok(!validateRules([gone], roots).has('g'), 'without the tree, folders are not checked');
});

test('a move whose folder is gone, with no path to fall back on, is flagged', () => {
  const flat = folderTree();
  const lost = withActions(rule('l', [cond('contains', 'rust')], ''), action('move', { folderId: 'deleted' }));
  assert.deepEqual(validateRules([lost], roots, flat).get('l'), ['The folder to move to no longer exists.']);
  assert.ok(!validateRules([lost], roots).has('l'), 'without the tree, the id is trusted');
  assert.equal(plan([bm('x', 'rust', 'https://x.test')], [lost]).changes.length, 0, 'it then moves nothing rather than failing');
  const kept = withActions(lost, action('move', { folderId: 'deleted', path: 'Dev' }));
  assert.ok(!validateRules([kept], roots, flat).has('l'), 'a path to fall back on is enough');
});

// ====
// Moving
// ====

test('a scoped rule moves only the bookmarks in its folders', () => {
  const flat = folderTree();
  const scoped = rule('s', [cond('contains', 'rust')], 'Dev', { sources: ['other/Inbox'] });
  assert.deepEqual(plan(flat, [scoped]).changes.map((c) => c.bookmark.id), ['a', 'c']);
  const shallow = rule('s', [cond('contains', 'rust')], 'Dev', { sources: ['other/Inbox'], sourceSubfolders: false });
  assert.deepEqual(plan(flat, [shallow]).changes.map((c) => c.bookmark.id), ['a']);
});

test('every matching rule acts in list order, so the last move wins', () => {
  const flat = [bm('a', 'Rust news', 'https://a.test'), bm('b', 'Rust guide', 'https://b.test', ['Other Bookmarks', 'Dev', 'Rust'])];
  const news = rule('news', [cond('contains', 'news')], 'Reading');
  const dev = rule('dev', [cond('contains', 'rust')], 'Other Bookmarks/Dev');
  const first = plan(flat, [news, dev]).changes;
  assert.deepEqual(first.map((c) => [c.bookmark.id, c.target.path.join('/')]), [['a', 'Other Bookmarks/Dev']], 'b is already inside Dev');
  assert.deepEqual(first[0].steps.map((s) => s.ruleId), ['dev'], 'the overridden move leaves the steps');
  const second = plan(flat, [dev, news]).changes;
  assert.deepEqual(second.map((c) => [c.bookmark.id, c.target.path.join('/')]), [['a', 'Other Bookmarks/Reading']]);
});

test('a later move to where the bookmark already is cancels an earlier one', () => {
  const flat = [bm('a', 'Rust', 'https://a.test', ['Bookmarks Menu'])];
  const away = rule('away', [cond('contains', 'rust')], 'Other Bookmarks/Dev');
  const stay = rule('stay', [cond('contains', 'rust')], 'Bookmarks Menu');
  assert.equal(plan(flat, [away, stay]).changes.length, 0);
});

test('a move follows its folder by id after a rename', () => {
  const flat = [{ id: 'f1', title: 'Renamed', type: 'folder', path: ['Bookmarks Menu'] }, bm('a', 'Rust', 'https://a.test', ['Other Bookmarks'])];
  const r = withActions(rule('r', [cond('contains', 'rust')], ''), action('move', { folderId: 'f1', path: 'Bookmarks Menu/Old name' }));
  const [change] = plan(flat, [r]).changes;
  assert.deepEqual(change.target, { folderId: 'f1', path: ['Bookmarks Menu', 'Renamed'] });
  assert.equal(change.steps[0].text, 'Move to “Bookmarks Menu › Renamed”');
});

// ====
// Editing, ignoring and deleting
// ====

test('replace actions build on each other and on earlier rules, in order', () => {
  const flat = [bm('a', 'Old Rust page', 'http://a.test/old')];
  const https = withActions(rule('https', [cond('contains', 'a.test')], ''), action('replace', { find: 'http:', replace: 'https:', field: 'url' }));
  const rename = withActions(rule('rename', [cond('contains', 'rust')], ''),
    action('replace', { find: 'old', replace: 'new', field: 'both' }),
    action('replace', { find: 'NEW', replace: 'Fresh', field: 'title', caseSensitive: true }),
    action('replace', { find: '(\\w+) page', replace: '$1 site', field: 'title', regex: true }));
  const [change] = plan(flat, [https, rename]).changes;
  assert.deepEqual(change.edits, { title: 'new Rust site', url: 'https://a.test/new' }, 'a case-sensitive search misses text it does not match exactly');
  assert.deepEqual(change.steps.map((s) => s.text), ['Replace “http:” with “https:” in URLs', 'Replace “old” with “new” in names and URLs', 'Replace “(\\w+) page” with “$1 site” in names']);
  assert.ok(hasEffect(change));
});

test('a replacement that leaves an invalid URL is flagged', () => {
  const r = withActions(rule('r', [cond('contains', 'a')], ''), action('replace', { find: 'https://', replace: '', field: 'url' }));
  const [change] = plan([bm('a', 'a', 'https://a.test')], [r]).changes;
  assert.equal(change.problem, 'The new URL is not a valid address');
});

test('deleting stops every later action and rule', () => {
  const flat = [bm('a', 'Spam', 'https://a.test')];
  const first = withActions(rule('first', [cond('contains', 'spam')], ''), action('ignore'), action('delete'), action('replace', { find: 'Spam', replace: 'Ham' }));
  const later = rule('later', [cond('contains', 'spam')], 'Dev');
  const { changes, matches } = plan(flat, [first, later]);
  assert.deepEqual(changes[0].steps.map((s) => s.action), ['ignore', 'delete']);
  assert.equal(changes[0].remove, true);
  assert.equal(changes[0].ignore, false, 'a deleted bookmark is not ignored as well');
  assert.deepEqual(changes[0].edits, {});
  assert.equal(changes[0].target, null);
  assert.equal(matches.get('later'), undefined, 'later rules do not even look at it');
});

test('ignoring keeps the bookmark and lets later rules act on it', () => {
  const flat = [bm('a', 'Docs', 'https://a.test')];
  const r = withActions(rule('r', [cond('contains', 'docs')], ''), action('ignore'));
  const move = rule('m', [cond('contains', 'docs')], 'Dev');
  const [change] = plan(flat, [r, move]).changes;
  assert.equal(change.ignore, true);
  assert.deepEqual(change.target.path, ['Other Bookmarks', 'Dev']);
  assert.ok(hasEffect({ ...change, target: null }));
});

// ====
// Page titles and redirects
// ====

test('page titles and redirects come from what is known of the page, or wait to be read', () => {
  const flat = [bm('a', 'a.test', 'https://a.test/'), bm('b', 'b.test', 'https://b.test/'), bm('c', 'c', 'https://c.test/')];
  const r = withActions(rule('r', [cond('contains', 'test')], ''), action('pageTitle'), action('redirect'));
  const pages = new Map([
    ['a', { url: 'https://a.test/', title: 'Alpha', finalUrl: 'https://alpha.test/' }],
    ['b', { url: 'https://old.test/', title: 'Stale' }],
    ['c', { url: 'https://c.test/', read: true }],
  ]);
  const { changes } = plan(flat, [r], { pages });
  assert.deepEqual(changes.map((c) => c.bookmark.id), ['a', 'b'], 'a page read with nothing to use changes nothing');
  assert.deepEqual(changes[0].edits, { title: 'Alpha', url: 'https://alpha.test/' });
  assert.equal(changes[0].waiting, false);
  assert.equal(changes[1].waiting, true, 'what was read for another URL is not used');
  assert.ok(changes[1].steps.every((s) => s.waiting));
  assert.ok(!hasEffect(changes[1]));
});

test('a page title already in use is not a change', () => {
  const r = withActions(rule('r', [cond('contains', 'alpha')], ''), action('pageTitle'));
  const pages = new Map([['a', { url: 'https://a.test/', title: 'Alpha' }]]);
  assert.equal(plan([bm('a', 'Alpha', 'https://a.test/')], [r], { pages }).changes.length, 0);
});

test('known pages come from the link check, with titles kept to the URL they were read from', () => {
  const pages = knownPages({
    titles: { a: { url: 'https://a.test/', title: 'Alpha' }, b: { url: 'https://b-old.test/', title: 'Old' } },
    results: [
      { id: 'a', url: 'https://a.test/', status: 'redirect', finalUrl: 'https://alpha.test/' },
      { id: 'b', url: 'https://b.test/', status: 'redirect', finalUrl: 'https://beta.test/' },
      { id: 'c', url: 'https://c.test/', status: 'broken' },
    ],
  });
  assert.deepEqual(Object.fromEntries(pages), {
    a: { url: 'https://a.test/', title: 'Alpha', finalUrl: 'https://alpha.test/' },
    b: { url: 'https://b.test/', finalUrl: 'https://beta.test/' },
  });
  assert.equal(knownPages(null).size, 0);
});

// ====
// Counts and explanations
// ====

test('the plan counts every bookmark each valid rule matches and changes, disabled rules included', () => {
  const flat = [bm('a', 'Rust book', 'https://a.test'), bm('b', 'Rust video', 'https://b.test', ['Bookmarks Menu', 'Rust']), bm('c', 'Python', 'https://c.test'), bm('d', 'Rust ignored', 'https://d.test')];
  const rust = rule('rust', [cond('contains', 'rust')], 'Bookmarks Menu/Rust');
  const video = rule('video', [cond('contains', 'video')], 'Bookmarks Menu/Video');
  const off = rule('off', [cond('contains', 'python')], 'Bookmarks Menu/Python', { enabled: false });
  const { matches, acting, changes } = plan(flat, [rust, video, off], { ignoredIds: new Set(['d']) });
  assert.deepEqual(Object.fromEntries(matches), { rust: 2, video: 1, off: 1 });
  assert.deepEqual(Object.fromEntries(acting), { rust: 1, video: 1 });
  assert.equal(changes.length, 2);
});

test('the plan lists bookmarks no enabled rule matches, leaving out ignored ones and folders', () => {
  const flat = [bm('a', 'Rust book', 'https://a.test'), bm('b', 'Python', 'https://b.test'), bm('c', 'Cooking', 'https://c.test'), bm('d', 'Ignored', 'https://d.test'), { id: 'f', title: 'Folder', type: 'folder', path: [] }];
  const rust = rule('rust', [cond('contains', 'rust')], 'Bookmarks Menu');
  const off = rule('off', [cond('contains', 'python')], 'Bookmarks Menu/Python', { enabled: false });
  const { unmatched } = plan(flat, [rust, off], { ignoredIds: new Set(['d']) });
  assert.deepEqual(unmatched.map((b) => b.id), ['b', 'c'], 'a bookmark already in its rule folder counts as matched');
});

test('a change explains what its first acting rule matched', () => {
  const b = bm('m', 'Cisco Meraki Documentation', 'https://documentation.meraki.com/x');
  const [change] = plan([b], [rule('r', [cond('contains', 'men')], 'X')]).changes;
  assert.deepEqual(change.why, { terms: [{ value: 'men', on: ['title', 'url'] }], title: [[17, 20]], url: [[12, 15]] });
  assert.equal(change.steps[0].ruleName, 'r');
});

test('a folder condition whose folder still exists by id is not flagged, and follows the folder', () => {
  const flat = folderTree();
  flat[1] = { ...flat[1], id: 'inbox', title: 'Renamed' };
  const scoped = rule('s', [cond('contains', 'rust')], 'Dev', { sources: ['other/Inbox'] });
  scoped.query.rules[0].folderId = 'inbox';
  assert.ok(!validateRules([scoped], roots, flat).has('s'));
  assert.deepEqual(plan(flat, [scoped]).changes.map((c) => c.bookmark.id), [], 'bookmarks sit under the old name, which the id no longer points at');
  flat[3] = { ...flat[3], path: ['Other Bookmarks', 'Renamed'] };
  assert.deepEqual(plan(flat, [scoped]).changes.map((c) => c.bookmark.id), ['a']);
  scoped.query.rules[0].folderId = 'gone';
  assert.match(validateRules([scoped], roots, flat).get('s')[0], /no longer exists/);
});
