import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom } from './browser-env.js';
import { openDashboard, main, click, findButton, answer, toasts, clearToasts, reload } from './ui-view-helpers.js';

const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'w1', title: 'Work', children: [{ id: 'x', title: 'X', url: 'https://x.test/' }] },
    { id: 'w2', title: 'Work', children: [{ id: 'y', title: 'Y', url: 'https://y.test/' }, { id: 'z', title: 'Z', url: 'https://z.test/' }] },
    { id: 'n1', title: '', children: [] },
    { id: 'n2', title: '', children: [] },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [
    { id: 'r1', title: 'Read', children: [] },
    { id: 'r2', title: 'Read', children: [] },
  ] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

const browser = await openDashboard({ view: 'same-name', tree: tree() });
after(uninstallDom);

const items = () => [...main().querySelectorAll('.item')];

test('each set of same-name siblings is listed with where it is and how much each holds', () => {
  assert.equal(items().length, 3);
  const work = items().find((li) => li.textContent.includes('Work'));
  assert.match(work.textContent, / × 2/);
  assert.match(work.textContent, /In Bookmarks Menu/);
  assert.match(work.textContent, /Items: 1 \+ 2/);
  assert.ok(items().some((li) => li.textContent.includes('(no name)')));
  assert.ok(findButton('Merge all (3)'));
  assert.equal(document.querySelector('#nav a[href="#same-name"] .badge').textContent, '3');
});

test('cancelling a merge changes nothing', async () => {
  const work = items().find((li) => li.textContent.includes('Work'));
  await click('Merge', work);
  assert.match(await answer(false), /^Merge 1 folder\(s\) into their first same-name sibling\?/);
  assert.equal((await browser.bookmarks.getChildren('menu________')).length, 4);
});

test('merging one set moves the contents into the first folder and removes the other', async () => {
  clearToasts();
  const work = items().find((li) => li.textContent.includes('Work'));
  await click('Merge', work);
  await answer(true);
  const [w1] = await browser.bookmarks.getSubTree('w1');
  assert.deepEqual(w1.children.map((c) => c.id), ['x', 'y', 'z']);
  await assert.rejects(browser.bookmarks.get('w2'));
  assert.match(toasts(), /Merged 1 folder\(s\)\./);
  assert.equal(items().length, 2);
});

test('ignoring a set adds each of its folders to the whitelist', async () => {
  const read = items().find((li) => li.textContent.includes('Read'));
  await click('Ignore', read);
  assert.deepEqual(Object.keys(browser.storage.local.data.whitelist).sort(), ['r1', 'r2']);
  assert.equal(items().length, 1);
});

test('Merge all merges every set listed', async () => {
  await browser.storage.local.set({ whitelist: {} });
  await reload();
  await click('Merge all (2)');
  assert.match(await answer(true), /^Merge 2 folder\(s\)/);
  assert.deepEqual((await browser.bookmarks.getChildren('toolbar_____')).map((c) => c.id), ['r1']);
  assert.equal(main().querySelector('.empty-state').textContent, 'No same-name folders.');
  assert.equal(findButton('Merge all (0)'), undefined);
});
