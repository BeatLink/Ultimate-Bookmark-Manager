import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom } from './browser-env.js';
import { openDashboard, main, click, findButton, reload } from './ui-view-helpers.js';

// ============================================================================
// Setup
// ============================================================================

// Menu holds a1 and the Work folder (a2, b1, b2 and Deep with a4); the toolbar holds a3 and b3.
const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'a1', title: 'Alpha one', url: 'https://alpha.test/', dateAdded: 1000 },
    { id: 'work', title: 'Work', children: [
      { id: 'a2', title: 'Alpha two', url: 'https://alpha.test/', dateAdded: 2000 },
      { id: 'b1', title: 'Beta one', url: 'https://beta.test/', dateAdded: 1500 },
      { id: 'b2', title: 'Beta two', url: 'https://beta.test/', dateAdded: 2500 },
      { id: 'deep', title: 'Deep', children: [
        { id: 'a4', title: 'Alpha four', url: 'https://alpha.test/', dateAdded: 3000 },
      ] },
    ] },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [
    { id: 'a3', title: 'Alpha three', url: 'https://alpha.test/', dateAdded: 500 },
    { id: 'b3', title: 'Beta three', url: 'https://beta.test/', dateAdded: 3500 },
  ] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

await openDashboard({ view: 'duplicates', tree: tree() });
after(uninstallDom);

const checked = () => [...main().querySelectorAll('input[data-sel]:checked')].map((box) => box.dataset.sel);
const folderSelect = () => main().querySelector('.folder-select select');
const subfolderBox = () => main().querySelector('.folder-select input[type=checkbox]');

function choose(control, value) {
  if (control.type === 'checkbox') control.checked = value;
  else control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

// ============================================================================
// Selecting by place in the tree
// ============================================================================

test('All but topmost keeps the copy highest up in the bookmarks', async () => {
  await click('All but topmost');

  assert.deepEqual(new Set(checked()), new Set(['a3', 'a2', 'a4', 'b2', 'b3']));
});

test('All but bottommost keeps the copy lowest down in the bookmarks', async () => {
  await click('All but bottommost');

  assert.deepEqual(new Set(checked()), new Set(['a1', 'a2', 'a4', 'b1', 'b2']));
});

test('Same-folder extras selects copies sharing a folder with an older copy', async () => {
  await click('Same-folder extras');

  assert.deepEqual(checked(), ['b2']);
});

// ============================================================================
// Selecting by folder
// ============================================================================

test('the folder list shows every folder holding a copy, in tree order', () => {
  const labels = [...folderSelect().options].map((option) => option.textContent);

  assert.deepEqual(labels, ['Bookmarks Menu', 'Bookmarks Menu › Work', 'Bookmarks Menu › Work › Deep', 'Bookmarks Toolbar']);
  assert.equal(subfolderBox().checked, true);
});

test('Select in folder picks the copies in the folder and its subfolders', async () => {
  choose(folderSelect(), 'work');
  await click('Select in folder');

  assert.deepEqual(new Set(checked()), new Set(['a2', 'a4', 'b1', 'b2']));
});

test('without subfolders only the folder’s own copies are picked', async () => {
  choose(subfolderBox(), false);
  await click('Select in folder');

  assert.deepEqual(new Set(checked()), new Set(['a2', 'b1', 'b2']));
});

test('Keep the folder’s copy selects every other copy of each URL it holds', async () => {
  choose(subfolderBox(), true);
  await click('Keep the folder’s copy');

  assert.deepEqual(new Set(checked()), new Set(['a3', 'a1', 'a4', 'b2', 'b3']));
  assert.equal(findButton('Remove selected').disabled, false);
});

test('the chosen folder is kept when the page redraws, and replaced once it holds no copies', async () => {
  await reload();
  assert.equal(folderSelect().value, 'work');

  choose(folderSelect(), 'gone');
  await reload();
  assert.equal(folderSelect().value, 'menu________');
});
