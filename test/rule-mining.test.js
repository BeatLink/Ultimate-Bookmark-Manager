import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteDomain, wordsOf, mineRules, proposalToRule } from '../src/lib/rule-mining.js';
import { planMoves } from '../src/lib/organize.js';
import { flatten } from '../src/lib/tree.js';

test('site domains drop subdomains but keep country second levels', () => {
  assert.equal(siteDomain('https://docs.python.org/3/'), 'python.org');
  assert.equal(siteDomain('https://www.bbc.co.uk/news'), 'bbc.co.uk');
  assert.equal(siteDomain('http://localhost:8080/'), null);
  assert.equal(siteDomain('http://192.168.1.1/'), null);
});

test('words come from title and path, without stop words, numbers or hashes', () => {
  assert.deepEqual([...wordsOf({ title: 'The Best Chili Recipe', url: 'https://x.test/recipes/chili-2024/abcdef1234567890' })].sort(), ['chili', 'recipe', 'recipes']);
});

const node = (title, url) => ({ title, url });
const folder = (title, children) => ({ title, children });
const tree = {
  id: 'root________',
  children: [
    { id: 'menu________', title: 'Bookmarks Menu', children: [
      folder('Recipes', [
        node('Chili recipe', 'https://www.seriouseats.com/chili'),
        node('Pizza recipe', 'https://www.seriouseats.com/pizza'),
        node('Curry recipe', 'https://www.bbcgoodfood.com/curry'),
        node('Easy guide to knives', 'https://knives.test/guide'),
      ]),
      folder('Programming', [
        node('Python docs', 'https://docs.python.org/3/'),
        node('Python tutorial', 'https://docs.python.org/3/tutorial/'),
        node('Rust guide', 'https://doc.rust-lang.org/book/'),
        folder('Git', [node('Pro Git', 'https://git-scm.com/book'), node('git rebase', 'https://git-scm.com/docs/git-rebase')]),
      ]),
      folder('Travel', [node('Japan guide', 'https://www.japan-guide.com/'), node('Rust belt road trip guide', 'https://roads.test/rust')]),
    ] },
    { id: 'unfiled_____', title: 'Other Bookmarks', children: [
      node('Lasagna recipe', 'https://www.allrecipes.com/lasagna'),
      node('Tacos', 'https://www.seriouseats.com/tacos'),
      node('asyncio', 'https://docs.python.org/3/library/asyncio.html'),
      node('git bisect', 'https://git-scm.com/docs/git-bisect'),
      node('Something else', 'https://other.test/'),
    ] },
  ],
};
let n = 0;
(function ids(node, parentId) {
  node.id ??= `n${++n}`;
  node.parentId = parentId;
  for (const c of node.children ?? []) ids(c, node.id);
})(tree, undefined);
const flat = flatten(tree);
const roots = tree.children.map((c) => ({ id: c.id, title: c.title }));
const source = ['Other Bookmarks'];

test('precise shared terms become one rule per folder; ambiguous ones are dropped', () => {
  const proposals = mineRules(flat, { sourcePath: source });
  const by = Object.fromEntries(proposals.map((p) => [p.path.join('/'), p]));
  assert.deepEqual(by['Bookmarks Menu/Recipes'].domains, ['seriouseats.com']);
  assert.deepEqual(by['Bookmarks Menu/Recipes'].words, ['recipe']);
  assert.equal(by['Bookmarks Menu/Recipes'].precision, 1);
  assert.ok(!by['Bookmarks Menu/Recipes'].words.includes('recipes'), 'a word containing an accepted word is redundant');
  assert.deepEqual(by['Bookmarks Menu/Programming'].domains, ['python.org']);
  assert.ok(!by['Bookmarks Menu/Programming'].words.includes('rust'), '"rust" also means a road trip in Travel');
  assert.deepEqual(by['Bookmarks Menu/Programming/Git'].domains, ['git-scm.com']);
  assert.ok(!by['Bookmarks Menu/Programming'].domains.includes('git-scm.com'), 'a term goes to the most specific folder');
  assert.ok(!Object.values(by).some((p) => p.words.includes('guide')), '"guide" is a stop word and also spread across folders');
  assert.ok(!by['Other Bookmarks'], 'the unsorted folder is never mined');
  assert.deepEqual(by['Bookmarks Menu/Recipes'].covers.map((b) => b.title).sort(), ['Lasagna recipe', 'Tacos']);
});

test('accepted rules only look in the unsorted folder and file what they cover', () => {
  const proposals = mineRules(flat, { sourcePath: source });
  const rules = proposals.map((p) => proposalToRule(p, source));
  assert.ok(rules.every((r) => r.sources[0] === 'Other Bookmarks' && r.sourceSubfolders === false && r.name.startsWith('Suggested: ')));
  const { moves, problems } = planMoves(flat, rules, roots);
  assert.equal(problems.size, 0);
  const where = Object.fromEntries(moves.map((m) => [m.bookmark.title, m.target.path.join('/')]));
  assert.deepEqual(where, {
    'Lasagna recipe': 'Bookmarks Menu/Recipes',
    Tacos: 'Bookmarks Menu/Recipes',
    asyncio: 'Bookmarks Menu/Programming',
    'git bisect': 'Bookmarks Menu/Programming/Git',
  });
});

test('terms already in an existing rule for the folder are not proposed again', () => {
  const existingRules = [{ target: 'Bookmarks Menu/Recipes', match: 'any', conditions: [{ op: 'domain', values: ['seriouseats.com'] }] }];
  const recipes = mineRules(flat, { sourcePath: source, existingRules }).find((p) => p.path.at(-1) === 'Recipes');
  assert.deepEqual(recipes.domains, []);
  assert.deepEqual(recipes.words, ['recipe']);
});

test('a stricter precision bar drops terms that stray into other folders', () => {
  const loose = mineRules(flat, { sourcePath: source, minPrecision: 0.5 });
  const strict = mineRules(flat, { sourcePath: source, minPrecision: 0.9 });
  const words = (ps) => ps.flatMap((p) => p.words);
  assert.ok(words(loose).length >= words(strict).length);
  for (const p of strict) assert.ok(p.precision >= 0.9);
});

test('removing a term re-scores the proposal', async () => {
  const { rescore } = await import('../src/lib/rule-mining.js');
  const recipes = mineRules(flat, { sourcePath: source }).find((p) => p.path.at(-1) === 'Recipes');
  const domainOnly = rescore(flat, { ...recipes, words: [] }, { sourcePath: source });
  assert.deepEqual(domainOnly.covers.map((b) => b.title), ['Tacos']);
  assert.equal(domainOnly.correct, 2);
  const nothing = rescore(flat, { ...recipes, words: [], domains: [] }, { sourcePath: source });
  assert.equal(nothing.covers.length, 0);
});

test('overlapping words collapse to the shortest, whichever is found first', () => {
  const t = { id: 'root________', children: [
    { id: 'menu________', title: 'Menu', children: [
      { id: 'f', title: 'Food', children: [
        { id: 'a', title: 'Recipes index', url: 'https://a.test/x' },
        { id: 'b', title: 'Recipes for soup', url: 'https://b.test/y' },
        { id: 'c', title: 'Recipes, recipe box', url: 'https://c.test/z' },
        { id: 'd', title: 'One recipe', url: 'https://d.test/w' },
      ] },
    ] },
    { id: 'unfiled_____', title: 'Other', children: [] },
  ] };
  (function ids(node, p) { node.parentId = p; (node.children ?? []).forEach((c) => ids(c, node.id)); })(t);
  const [food] = mineRules(flatten(t), { sourcePath: ['Other'] });
  assert.deepEqual(food.words.filter((w) => w.startsWith('recipe')), ['recipe']);
});
