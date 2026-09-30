import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlWords, bookmarkText, candidateFolders, suggest, nameFromWords, clusterLeftovers, modelProblem } from '../src/lib/ai-organize.js';
import { flatten } from '../src/lib/tree.js';

// Unit vectors on named axes stand in for embeddings: equal axes mean "same topic".
const AXES = ['cooking', 'code', 'news', 'music', 'x', 'y'];
const v = (...weights) => {
  const out = AXES.map((a) => weights.find(([k]) => k === a)?.[1] ?? 0);
  const n = Math.hypot(...out) || 1;
  return out.map((x) => x / n);
};
const on = (axis) => v([axis, 1]);

test('addresses become readable words without ids or extensions', () => {
  assert.equal(urlWords('https://www.seriouseats.com/best-chili-recipe-12345.html?utm=x'), 'seriouseats best chili recipe html');
  assert.equal(urlWords('https://github.com/user/repo/commit/0123456789abcdef0123'), 'github user repo commit');
  assert.equal(urlWords('not a url'), '');
});

test('bookmark text follows the chosen parts', () => {
  const b = { title: 'Saved name', url: 'https://ex.com/chili-recipe' };
  const page = { title: 'Best Chili', summary: 'A spicy stew.', description: 'Chili guide', headings: 'Ingredients', text: 'Beans and beef.' };
  assert.equal(bookmarkText(b, null, { useUrl: true, useTitle: true }), 'Saved name. ex chili recipe');
  assert.equal(bookmarkText(b, page, { useTitle: true }), 'Best Chili');
  assert.equal(bookmarkText(b, page, { useSummary: true, useContent: true }), 'A spicy stew.. Chili guide. Ingredients. Beans and beef.');
});

const tree = {
  id: 'root________',
  children: [
    { id: 'menu________', title: 'Bookmarks Menu', children: [
      { id: 'f-cook', title: 'Cooking', children: [{ id: 'c1', title: 'Pasta', url: 'https://c.test/pasta' }] },
      { id: 'f-code', title: 'Dev', children: [{ id: 'd1', title: 'Rust book', url: 'https://d.test/rust' }] },
      { id: 'f-news', title: 'Reading', children: [] },
    ] },
    { id: 'unfiled_____', title: 'Other Bookmarks', children: [
      { id: 'u1', title: 'Chili', url: 'https://u.test/chili' },
      { id: 'u2', title: 'Cargo guide', url: 'https://u.test/cargo' },
      { id: 'u3', title: 'Guitar chords', url: 'https://u.test/guitar' },
      { id: 'u4', title: 'Guitar tabs', url: 'https://u.test/tabs' },
      { id: 'u5', title: 'Morning headlines', url: 'https://u.test/news' },
      { id: 'u6', title: 'Oddity', url: 'https://u.test/odd' },
    ] },
  ],
};

// Firefox gives every node its parent's id; the literal tree above leaves that out.
(function addParents(node) {
  for (const c of node.children ?? []) {
    c.parentId = node.id;
    addParents(c);
  }
})(tree);

const ROOTS = tree.children.map((c) => ({ id: c.id, title: c.title }));

function setup(rules = [], useRules = true) {
  const flat = flatten(tree);
  const folders = candidateFolders(flat, tree, { sourceId: 'unfiled_____', rules, useRules });
  const nameVecs = { Cooking: on('cooking'), Dev: on('code'), Reading: v(['news', 1], ['x', 0.1]), 'Bookmarks Menu': on('y'), Other: on('y') };
  for (const f of folders) {
    f.nameVec = nameVecs[f.path.at(-1)] ?? on('y');
    for (const m of f.members) m.vec = { c1: on('cooking'), d1: on('code') }[m.id];
  }
  const vecs = { u1: v(['cooking', 1], ['x', 0.2]), u2: v(['code', 1], ['y', 0.2]), u3: on('music'), u4: v(['music', 1], ['x', 0.1]), u5: on('news'), u6: on('x') };
  const bookmarks = flat.filter((n) => n.parentId === 'unfiled_____').map((b) => ({ ...b, vec: vecs[b.id], text: b.title }));
  return { flat, folders, bookmarks };
}

test('candidate folders exclude the source folder and carry rule keywords', () => {
  const rules = [{ id: 'r', enabled: true, match: 'any', conditions: [{ field: 'title', op: 'contains', values: ['headlines', 'breaking'] }], target: 'Bookmarks Menu/Reading' }];
  const { folders } = setup(rules);
  assert.ok(!folders.some((f) => f.id === 'unfiled_____'));
  assert.ok(!folders.some((f) => f.id === 'menu________'), 'top-level folders are not candidates');
  assert.equal(new Set(folders.map((f) => f.id)).size, folders.length, 'no folder listed twice');
  assert.equal(folders.find((f) => f.id === 'f-news').text, 'Reading. headlines. breaking');
});

test('bookmarks go to the closest folder; unmatched look-alikes get a new folder', () => {
  const { folders, bookmarks } = setup();
  const out = Object.fromEntries(suggest(bookmarks, folders, { sourcePath: ['Other Bookmarks'] }).map((s) => [s.bookmark.id, s]));
  assert.deepEqual(out.u1.path, ['Bookmarks Menu', 'Cooking']);
  assert.equal(out.u1.confidence, 'high');
  assert.match(out.u1.reason, /similar to “Pasta”/);
  assert.deepEqual(out.u2.path, ['Bookmarks Menu', 'Dev']);
  assert.deepEqual(out.u3.path, ['Other Bookmarks', 'Guitar']);
  assert.ok(out.u3.isNew && out.u4.isNew);
  assert.equal(out.u6.confidence, 'low', 'a lone oddity is left as a weak guess');
  assert.ok(!out.u6.isNew);
});

test('a matching Organize rule outweighs similarity when rules are used', () => {
  const rules = [{ id: 'r', enabled: true, match: 'any', conditions: [{ field: 'title', op: 'contains', values: ['chili'] }], target: 'Bookmarks Menu/Dev' }];
  const withRules = setup(rules, true);
  const s1 = suggest(withRules.bookmarks, withRules.folders, { sourcePath: ['Other Bookmarks'], rootFolders: ROOTS, rules, useRules: true }).find((s) => s.bookmark.id === 'u1');
  assert.deepEqual(s1.path, ['Bookmarks Menu', 'Dev']);
  assert.match(s1.reason, /Organize rules/);
  const without = setup(rules, false);
  const s2 = suggest(without.bookmarks, without.folders, { sourcePath: ['Other Bookmarks'], rootFolders: ROOTS, rules, useRules: false }).find((s) => s.bookmark.id === 'u1');
  assert.deepEqual(s2.path, ['Bookmarks Menu', 'Cooking']);
});

test('new folder names use the most shared meaningful word and avoid existing names', () => {
  assert.equal(nameFromWords(['Guitar chords for beginners', 'Easy guitar tabs', 'www.guitar.com']), 'Guitar');
  assert.equal(nameFromWords(['Guitar chords', 'guitar tabs'], new Set(['guitar'])), 'Chords');
  assert.equal(nameFromWords(['a', 'the']), 'New folder');
  assert.equal(nameFromWords(['Guitar chords easy. music guitar chords', 'Guitar tabs easy. music guitar tabs']), 'Guitar', 'title + address words beat adjectives');
  assert.equal(clusterLeftovers([{ vec: on('x') }, { vec: on('y') }]).length, 0);
});

test('custom model ids are checked against what Firefox allows', () => {
  assert.equal(modelProblem('Xenova/all-MiniLM-L6-v2'), null);
  assert.equal(modelProblem('Mozilla/some-model'), null);
  assert.match(modelProblem('sentence-transformers/all-MiniLM-L6-v2'), /Xenova, Mozilla or onnx-community/);
  assert.equal(modelProblem('onnx-community/embeddinggemma-300m-ONNX'), null);
  assert.match(modelProblem('nonsense'), /organisation\/model-name/);
  assert.match(modelProblem(''), /Enter a model id/);
});
