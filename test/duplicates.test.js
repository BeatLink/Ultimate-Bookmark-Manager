import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, expandReplacement, findDuplicates, compileRules, allButTreeEnd, copiesInFolders, keepCopyInFolders, sameFolderExtras, foldersHoldingCopies, folderAndSubfolders, DEFAULT_MATCHING } from '../src/lib/duplicates.js';

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

test('groups are numbered oldest first, ignore whitelisted ids and count the extra copies', () => {
  const list = [bm('b', 'https://a.test/', { dateAdded: 5 }), bm('a', 'https://a.test/', { dateAdded: 1 }), bm('c', 'https://a.test/', { dateAdded: 9 }), bm('d', 'https://other.test/')];
  const { groups, extra } = findDuplicates(list, { ignoredIds: new Set(['c']) });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map((i) => [i.id, i.order]), [['a', 1], ['b', 2]]);
  assert.equal(extra, 1);
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

test('text that is not a URL is compared as written, folding case only when asked', () => {
  assert.equal(normalizeUrl('Not A URL'), 'Not A URL');
  assert.equal(normalizeUrl('Not A URL', { ...DEFAULT_MATCHING, ignoreCase: true }), 'not a url');
});

// ============================================================================
// Rule conditions
// ============================================================================

const keys = (list, rules) => findDuplicates(list, { rules }).groups.map((g) => g.items.map((item) => item.id));

test('a filter rule with an unless condition spares the bookmarks the condition matches', () => {
  const list = [bm('a', 'https://x.test/'), bm('b', 'https://x.test/'), bm('keep', 'https://y.test/', { path: ['Keep'] }), bm('keep2', 'https://y.test/', { path: ['Keep'] })];
  const rules = [{ kind: 'filter', field: 'url', pattern: '.', conditions: [{ field: 'name', pattern: '^Keep/', negate: true }] }];

  assert.deepEqual(keys(list, rules), [['keep', 'keep2']]);
});

test('a replace rule with an only-if condition rewrites only the URLs it matches', () => {
  const list = [bm('a', 'https://x.test/?id=1', { path: ['Shop'] }), bm('b', 'https://x.test/?id=2', { path: ['Shop'] }), bm('c', 'https://z.test/?id=1'), bm('d', 'https://z.test/?id=2')];
  const rules = [{ kind: 'replace', pattern: '\\?.*', replacement: '', conditions: [{ field: 'name', pattern: '^Shop/' }, { pattern: '' }] }];

  assert.deepEqual(keys(list, rules), [['a', 'b']]);
});

test('a replace condition on the URL sees what earlier rules made of it', () => {
  const list = [bm('a', 'https://old.test/p'), bm('b', 'https://new.test/p')];
  const rules = [
    { kind: 'replace', pattern: 'old', replacement: 'mid' },
    { kind: 'replace', pattern: 'mid', replacement: 'new', conditions: [{ field: 'url', pattern: '^https://mid' }] },
  ];

  assert.deepEqual(keys(list, rules), [['a', 'b']]);
});

test('an invalid condition makes its rule invalid, and stored rubbish is ignored', () => {
  const compiled = compileRules([
    { kind: 'filter', pattern: 'x', conditions: [{ pattern: '(' }] },
    { kind: 'filter', pattern: 'y', conditions: 'not a list' },
  ]);

  assert.equal(compiled.errors.length, 1);
  assert.equal(compiled.errors[0].index, 0);
  assert.match(compiled.errors[0].message, /^Condition 1: /);
  assert.deepEqual(compiled.filters[0].conditions, []);
});

// ============================================================================
// Choosing which copies to select
// ============================================================================

// Menu holds a1 and the Work folder (a2, b1, b2 and Deep with a4); the toolbar holds a3 and b3.
const nested_flat = () => {
  const node = (id, parentId, path, extra) => ({ id, parentId, path, title: id, type: 'bookmark', dateAdded: 0, ...extra });
  return [
    node('menu', 'root', [], { type: 'folder', title: 'Menu' }),
    node('a1', 'menu', ['Menu'], { url: 'https://a.test/', dateAdded: 1000 }),
    node('work', 'menu', ['Menu'], { type: 'folder', title: 'Work' }),
    node('a2', 'work', ['Menu', 'Work'], { url: 'https://a.test/', dateAdded: 2000 }),
    node('b1', 'work', ['Menu', 'Work'], { url: 'https://b.test/', dateAdded: 1500 }),
    node('b2', 'work', ['Menu', 'Work'], { url: 'https://b.test/', dateAdded: 2500 }),
    node('deep', 'work', ['Menu', 'Work'], { type: 'folder', title: 'Deep' }),
    node('a4', 'deep', ['Menu', 'Work', 'Deep'], { url: 'https://a.test/', dateAdded: 3000 }),
    node('toolbar', 'root', [], { type: 'folder', title: 'Toolbar' }),
    node('a3', 'toolbar', ['Toolbar'], { url: 'https://a.test/', dateAdded: 500 }),
    node('b3', 'toolbar', ['Toolbar'], { url: 'https://b.test/', dateAdded: 3500 }),
    node('lonely', 'toolbar', ['Toolbar'], { type: 'folder', title: 'Lonely' }),
  ];
};

test('the topmost or bottommost copy in the tree can be the one kept', () => {
  const { groups } = findDuplicates(nested_flat());

  assert.deepEqual(allButTreeEnd(groups), ['a3', 'a2', 'a4', 'b2', 'b3']);
  assert.deepEqual(allButTreeEnd(groups, true), ['a1', 'a2', 'a4', 'b1', 'b2']);
});

test('copies sharing a folder with an older copy are the same-folder extras', () => {
  const { groups } = findDuplicates(nested_flat());

  assert.deepEqual(sameFolderExtras(groups), ['b2']);
});

test('copies in a folder, with or without its subfolders, can be selected or kept', () => {
  const flat = nested_flat();
  const { groups } = findDuplicates(flat);
  const with_subfolders = folderAndSubfolders(flat, 'work');

  assert.deepEqual([...with_subfolders], ['work', 'deep']);
  assert.deepEqual(copiesInFolders(groups, with_subfolders), ['a2', 'a4', 'b1', 'b2']);
  assert.deepEqual(copiesInFolders(groups, new Set(['work'])), ['a2', 'b1', 'b2']);
  assert.deepEqual(keepCopyInFolders(groups, with_subfolders), ['a3', 'a1', 'a4', 'b2', 'b3']);
  assert.deepEqual(keepCopyInFolders(groups, new Set(['deep'])), ['a3', 'a1', 'a2']);
});

test('the folder list holds every folder with a copy inside it, in tree order', () => {
  const flat = nested_flat();
  const { groups } = findDuplicates(flat);

  assert.deepEqual(foldersHoldingCopies(groups, flat), [
    { id: 'menu', path: ['Menu'] },
    { id: 'work', path: ['Menu', 'Work'] },
    { id: 'deep', path: ['Menu', 'Work', 'Deep'] },
    { id: 'toolbar', path: ['Toolbar'] },
  ]);
});

test('a condition with no field tests the URL, as does one with an unknown field', () => {
  const list = [bm('a', 'https://x.test/'), bm('b', 'https://x.test/')];
  const by_default = [{ kind: 'filter', pattern: '.', flags: 'g', conditions: [{ pattern: 'x\\.test', flags: 'gi' }] }];
  const unknown_field = [{ kind: 'filter', pattern: '.', conditions: [{ field: 'colour', pattern: 'nothing-here' }] }];

  assert.deepEqual(keys(list, by_default), []);
  assert.deepEqual(keys(list, unknown_field), [['a', 'b']]);
});
