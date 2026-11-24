import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTarget, moveRulePaths, duplicateRule, describeRule, describeAction, migrateRule, moveToNewRule, mergeRules, reorder, newCondition, newGroup, newRule, newAction, ruleName, folderLabel, folderPaths, resolveMove, refreshMovePaths, isWellFormedRule } from '../src/lib/rules.js';
import { ruleMatches } from '../src/lib/matching.js';
import { roots, bm, cond, group, rule, queryRule } from './helpers.js';

test('targets resolve against root titles and aliases, else go under Other Bookmarks', () => {
  assert.deepEqual(resolveTarget('Bookmarks Toolbar/Dev', roots), { rootId: 'toolbar_____', path: ['Bookmarks Toolbar', 'Dev'], segments: ['Dev'] });
  assert.equal(resolveTarget('menu / A / B', roots).rootId, 'menu________');
  assert.deepEqual(resolveTarget('Reading/News', roots).path, ['Other Bookmarks', 'Reading', 'News']);
  assert.equal(resolveTarget('  ', roots), null);
});

test('names and folder paths are shown in words', () => {
  assert.equal(ruleName({ name: 'Rust' }), 'Rust');
  assert.equal(ruleName({ name: '' }), 'Unnamed rule');
  assert.equal(folderLabel('Other Bookmarks/Dev/Rust'), 'Other Bookmarks › Dev › Rust');
});

test('new conditions match inside words until whole words is ticked, and a new group holds one empty condition', () => {
  assert.equal(newCondition().wholeWords, false);
  const a = newGroup();
  const b = newGroup(undefined, 'and');
  assert.deepEqual([a.combinator, b.combinator, a.not, a.rules.length, a.rules[0].value], ['or', 'and', false, 1, '']);
  assert.equal(new Set([a.id, b.id, a.rules[0].id, b.rules[0].id]).size, 4, 'every id is unique');
});

test('a duplicated rule is an independent copy with its own id', () => {
  const original = rule('orig', [cond('contains', 'rust')], 'Dev', { name: 'Rust' });
  const copy = duplicateRule(original);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.name, 'Rust (copy)');
  assert.equal(copy.actions[0].path, 'Dev');
  assert.notEqual(copy.actions[0].id, original.actions[0].id, 'actions get new ids');
  copy.actions[0].path = 'Go';
  assert.equal(original.actions[0].path, 'Dev');
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
  assert.equal(describeRule(rule('r', [cond('startsWith', '/guide', { field: 'path' })], 'X')), 'URL path starts with “/guide”');
  assert.equal(describeRule(rule('r', [cond('contains', '')], 'X')), 'No conditions yet');
});

test('nested groups are summed up with brackets and "not"', () => {
  const r = rule('r', [
    cond('contains', 'rust', { field: 'title' }),
    group('none', [cond('domain', 'reddit.com'), cond('contains', 'meme', { field: 'title' })]),
    group('any', [cond('contains', 'book', { field: 'title' })]),
  ], 'Dev', { match: 'all' });
  assert.equal(describeRule(r), 'title contains “rust” and not (site name is on domain “reddit.com” or title contains “meme”) and title contains “book”');
});

test('a none group always gets brackets, even with one condition', () => {
  const r = rule('r', [cond('contains', 'work')], 'X', { match: 'none' });
  assert.equal(describeRule(r), 'not (title or URL contains “work”)');
});

test('old comma-separated keyword lists become one condition each', () => {
  assert.equal(rule('t', [{ field: 'title', op: 'contains', value: 'nobody, profile' }], 'X').query.rules.length, 2);
});

test('a leftover catch-all flag is dropped from an otherwise current rule', () => {
  const old = { id: 'c', name: 'c', enabled: true, catchAll: true, target: 'Other Bookmarks/Inbox', query: { combinator: 'and', rules: [{ id: 'f', field: 'folder', operator: 'directlyInFolder', value: 'Other Bookmarks' }] } };
  const migrated = migrateRule(old);
  assert.ok(!('catchAll' in migrated));
  assert.equal(migrated.query, old.query, 'the query is kept as it is');
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
  const { id: actionId, ...move } = r.actions[0];
  assert.equal(typeof actionId, 'string');
  assert.deepEqual(move, { type: 'move', folderId: '', path: 'Dev' }, 'the target becomes a move');
  assert.deepEqual({ ...r, query: undefined, actions: undefined }, { id: 'r', name: 'Rust', enabled: true, autoRun: false, createdAt: 5, query: undefined, actions: undefined }, 'ranking goes and everything else is kept');
  assert.equal(migrateRule(old, { autoRun: true }).autoRun, true, 'it runs on new bookmarks when automatic organizing was on');
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
});

test('an old rule with only source folders keeps them as its one condition', () => {
  const strip = (item) => {
    const { id, ...rest } = item;
    return rest.rules ? { ...rest, rules: rest.rules.map(strip) } : rest;
  };
  const catchAll = migrateRule({ id: 'c', catchAll: true, conditions: [], target: 'X', sources: ['Other Bookmarks'], sourceSubfolders: false });
  assert.deepEqual(strip(catchAll.query), { combinator: 'or', not: false, rules: [{ field: 'folder', operator: 'directlyInFolder', value: 'Other Bookmarks' }] });
  assert.ok(!('catchAll' in catchAll), 'the catch-all flag is dropped');
});

test('an old "any" rule with a source folder is wrapped so its folder still has to match', () => {
  const strip = (item) => {
    const { id, ...rest } = item;
    return rest.rules ? { ...rest, rules: rest.rules.map(strip) } : rest;
  };
  const anyWithFolder = migrateRule({ id: 'a', match: 'any', conditions: [{ field: 'title', op: 'contains', values: ['a'] }], sources: ['Other Bookmarks'] });
  assert.deepEqual(strip(anyWithFolder.query), { combinator: 'and', not: false, rules: [
    { field: 'folder', operator: 'inFolder', value: 'Other Bookmarks' },
    { combinator: 'or', not: false, rules: [{ field: 'title', operator: 'contains', value: 'a', caseSensitive: false, wholeWords: false }] },
  ] });
});

test('a condition or group can move into a new rule that keeps the actions and folders', () => {
  const src = { ...rule('src', [cond('contains', 'music', { field: 'title' }), cond('domain', 'youtube.com')], 'Bookmarks Menu/YouTube',
    { match: 'all', sources: ['Other Bookmarks'], name: 'YouTube' }), autoRun: true };
  const fan = rule('fan', [cond('contains', 'x')], 'X');
  const music = src.query.rules.find((c) => c.value === 'music');
  const { rules, part } = moveToNewRule([src, fan], 'src', music.id);
  assert.deepEqual(rules.map((r) => r.id), ['src', part.id, 'fan'], 'the new rule comes right after the old one');
  const old = rules[0];
  assert.ok(!old.query.rules.some((c) => c.value === 'music'), 'it leaves the old rule');
  assert.equal(part.name, 'YouTube (part)');
  assert.equal(part.actions[0].path, 'Bookmarks Menu/YouTube');
  assert.notEqual(part.actions[0].id, src.actions[0].id);
  assert.equal(part.autoRun, true);
  assert.equal(rules[2], fan, 'other rules are left alone');
  assert.equal(part.query.combinator, 'and');
  assert.deepEqual(part.query.rules.map((c) => [c.field, c.value]), [['folder', 'Other Bookmarks'], ['title', 'music']], 'folder scope goes with it');
  assert.notEqual(part.query.rules[1].id, music.id, 'with new ids');
  const b = bm('1', 'Music mix', 'https://a.test', ['Other Bookmarks']);
  assert.ok(ruleMatches(part, b));
  assert.ok(!ruleMatches(part, { ...b, path: ['Bookmarks Menu'] }));
  assert.equal(moveToNewRule([src], 'src', 'nope'), null);
});

test('merging rules joins their conditions with "any" and keeps the first rule\'s actions', () => {
  const a = rule('a', [cond('contains', 'rust')], 'Dev');
  const b = rule('b', [cond('contains', 'go'), cond('contains', 'zig')], 'Other', { match: 'all' });
  const c = rule('c', [cond('contains', 'c')], 'C');
  const out = mergeRules([a, b, c], 'a', 'b');
  assert.deepEqual(out.map((r) => r.id), ['a', 'c']);
  const merged = out[0];
  assert.equal(merged.actions, a.actions, 'the kept rule keeps its actions');
  assert.equal(out[1], c);
  assert.equal(mergeRules(out, 'a', 'a'), out, 'a rule is not merged into itself');
  assert.equal(merged.query.combinator, 'or');
  assert.equal(merged.query.rules.length, 2, 'the "any" query is joined directly, the "all" one kept as a group');
  const has = (title) => ruleMatches(merged, bm('1', title, 'https://a.test'));
  assert.ok(has('rust'));
  assert.ok(has('go zig'));
  assert.ok(!has('go'));
});

test('moving a folder points destinations and folder conditions inside it at the new place', () => {
  const inDev = queryRule('a', { combinator: 'and', rules: [
    { id: 'f', field: 'folder', operator: 'inFolder', value: 'Bookmarks Menu/Dev' },
    { combinator: 'or', rules: [{ id: 'g', field: 'folder', operator: 'directlyInFolder', value: 'menu/Dev/Old' }] },
    { id: 'k', field: 'either', operator: 'contains', value: 'Dev' },
  ] }, 'Bookmarks Menu/Dev/Rust');
  const other = rule('b', [cond('contains', 'x')], 'Bookmarks Menu/Developer');
  const rules = [inDev, other];
  const out = moveRulePaths(rules, ['Bookmarks Menu', 'Dev'], ['Other Bookmarks', 'Work', 'Dev'], roots);
  assert.equal(out[0].actions[0].path, 'Other Bookmarks/Work/Dev/Rust');
  assert.equal(out[0].query.rules[0].value, 'Other Bookmarks/Work/Dev');
  assert.equal(out[0].query.rules[1].rules[0].value, 'Other Bookmarks/Work/Dev/Old');
  assert.equal(out[0].query.rules[2].value, 'Dev', 'keywords are left alone');
  assert.equal(out[1], other, 'a folder that only starts with the same letters is not inside it');
  assert.equal(moveRulePaths(rules, ['Bookmarks Toolbar', 'X'], ['Other Bookmarks', 'X'], roots), rules, 'untouched rules come back as the same list');
});

test('a new rule starts enabled, off for new bookmarks, with one move action', () => {
  const r = newRule();
  assert.equal(r.enabled, true);
  assert.equal(r.autoRun, false);
  assert.deepEqual(r.actions.map((a) => a.type), ['move']);
  assert.ok(isWellFormedRule(r));
  assert.deepEqual({ ...newAction('replace'), id: 0 }, { id: 0, type: 'replace', find: '', replace: '', field: 'both', caseSensitive: false, regex: false });
  assert.deepEqual({ ...newAction('delete'), id: 0 }, { id: 0, type: 'delete' });
});

test('a rule needs a list of known, complete actions to be read', () => {
  const r = rule('r', [cond('contains', 'x')], 'Dev');
  assert.ok(isWellFormedRule(r));
  assert.ok(!isWellFormedRule({ ...r, actions: undefined }));
  assert.ok(!isWellFormedRule({ ...r, actions: [{ id: 'a', type: 'explode' }] }));
  assert.ok(!isWellFormedRule({ ...r, actions: [{ id: 'a', type: 'move', path: 5, folderId: '' }] }));
  assert.ok(!isWellFormedRule({ ...r, actions: [{ id: 'a', type: 'replace', find: 'a', replace: 'b', field: 'everywhere' }] }));
  assert.ok(!isWellFormedRule({ ...r, actions: [null] }));
  assert.ok(isWellFormedRule({ ...r, actions: [{ id: 'a', type: 'ignore' }] }));
});

test('a current rule with leftover ranking loses it and keeps its actions', () => {
  const current = { ...newRule(), outranks: ['x'], rankAll: 'above' };
  const out = migrateRule(current);
  assert.ok(!('outranks' in out) && !('rankAll' in out));
  assert.equal(out.actions, current.actions);
  const clean = newRule();
  assert.equal(migrateRule(clean), clean);
  assert.deepEqual(migrateRule({ id: 'n', query: newGroup() }).actions[0].path, '', 'a rule without a target gets a move still to choose');
});

test('actions are summed up in plain words', () => {
  assert.equal(describeAction({ type: 'move', path: 'Other Bookmarks/Dev' }), 'Move to “Other Bookmarks › Dev”');
  assert.equal(describeAction({ type: 'move', path: '' }), 'Move to a folder not chosen yet');
  assert.equal(describeAction({ type: 'replace', find: 'http:', replace: 'https:', field: 'url' }), 'Replace “http:” with “https:” in URLs');
  assert.equal(describeAction({ type: 'replace', find: 'a', replace: '', field: 'odd' }), 'Replace “a” with “” in names and URLs');
  assert.equal(describeAction({ type: 'delete' }), 'Delete');
  assert.equal(describeAction({ type: 'mystery' }), 'mystery');
});

test('a move finds its folder by id wherever it now is, and falls back to its path', () => {
  const flat = [
    { id: 'menu________', type: 'folder', title: 'Bookmarks Menu', path: [] },
    { id: 'f1', type: 'folder', title: 'Renamed', path: ['Bookmarks Menu'] },
    { id: 'b1', type: 'bookmark', title: 'x', path: ['Bookmarks Menu'] },
  ];
  const folders = folderPaths(flat);
  assert.deepEqual([...folders.keys()], ['menu________', 'f1']);
  assert.deepEqual(resolveMove({ folderId: 'f1', path: 'Bookmarks Menu/Old' }, folders, roots), { folderId: 'f1', path: ['Bookmarks Menu', 'Renamed'] });
  assert.deepEqual(resolveMove({ folderId: 'gone', path: 'Bookmarks Menu/Old' }, folders, roots).segments, ['Old']);
  assert.equal(resolveMove({ folderId: '', path: '' }, folders, roots), null);

  const rules = [{ ...newRule(), actions: [{ id: 'a', type: 'move', folderId: 'f1', path: 'Bookmarks Menu/Old' }, { id: 'b', type: 'delete' }] }, newRule()];
  const out = refreshMovePaths(rules, folders);
  assert.equal(out[0].actions[0].path, 'Bookmarks Menu/Renamed');
  assert.equal(out[0].actions[1], rules[0].actions[1]);
  assert.equal(out[1], rules[1]);
  assert.equal(refreshMovePaths(out, folders), out, 'paths already up to date leave the list as it was');
});

test('reordering moves one item and keeps the rest in order', () => {
  assert.deepEqual(reorder(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(reorder(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(reorder(['a', 'b', 'c'], 1, 9), ['a', 'c', 'b'], 'past the end goes last');
  assert.deepEqual(reorder(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c'], 'before the start goes first');
});
