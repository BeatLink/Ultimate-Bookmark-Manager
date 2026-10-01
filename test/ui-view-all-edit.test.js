import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom } from './browser-env.js';
import {
  startAll, idle, list, rowIds, rowEl, selectedIds, focusedId, searchBox, toolbarButton, toasts, lastToast,
  fire, press, pick, rightClick, menuItems, menuOpen, choose, closeMenu, dialog, dialogText, answer, childTitles,
} from './ui-view-all-helpers.js';

const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'a', title: 'Alpha', url: 'https://alpha.test/' },
    { id: 'b', title: 'Beta', url: 'https://beta.test/' },
    { id: 'c', title: 'Gamma', url: 'https://gamma.test/' },
    { id: 'f1', title: 'Work', children: [
      { id: 'w1', title: 'Wiki', url: 'https://wiki.test/' },
      { id: 'w2', title: 'Web', url: 'https://web.test/' },
    ] },
    { id: 's1', type: 'separator' },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [
    { id: 't1', title: 'Tool', url: 'https://tool.test/' },
    { id: 'big', title: 'Big', children: Array.from({ length: 16 }, (_, i) => ({ id: `g${i}`, title: `G${i}`, url: `https://g.test/${i}` })) },
  ] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [
    { id: 'z', title: 'Zed', children: [
      { id: 'z2', title: 'Zulu', url: 'https://zulu.test/' },
      { id: 'z1', title: 'Ant', url: 'https://ant.test/' },
    ] },
    { id: 'e', title: 'Empty', children: [] },
  ] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

const ctrl = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';

before(async () => {
  await startAll(tree());
});
after(uninstallDom);

test('the right-click menu on a bookmark offers opening, adding, editing and sorting its folder', () => {
  pick('a');
  rightClick('a');
  assert.deepEqual(menuItems(), [
    'Open in new tab', 'Open in new window', 'Open in new private window', 'Open in new container tab…',
    'New bookmark…', 'New folder…', 'New separator', 'Bookmark all tabs…',
    'Undo', 'Redo', 'Cut', 'Copy', 'Paste (off)', 'Delete',
    'Sort “Bookmarks Menu” by name', 'Properties…',
  ]);
  const keys = [...document.querySelectorAll('dialog.menu .menu-key')].map((k) => k.textContent);
  assert.deepEqual(keys, ['Enter', `${ctrl}Z`, `${ctrl}Shift+Z`, `${ctrl}X`, `${ctrl}C`, `${ctrl}V`, 'Del', 'F2']);
  closeMenu();
  assert.equal(menuOpen(), false);
  assert.equal(focusedId(), 'a');
});

test('the right-click menu adapts to a folder, a top folder, several items and empty space', () => {
  rightClick('f1');
  assert.deepEqual(selectedIds(), ['f1']);
  assert.deepEqual(menuItems().filter((t) => /Open|Ignore|Sort|Properties/.test(t)), [
    'Open all in tabs', 'Ignore folder and everything inside', 'Sort “Work” by name', 'Properties…',
  ]);
  closeMenu();

  rightClick('menu________');
  assert.deepEqual(menuItems().filter((t) => /Cut|Copy|Delete|Properties/.test(t)), ['Cut (off)', 'Copy', 'Delete (off)', 'Properties… (off)']);
  closeMenu();

  rightClick('e');
  assert.ok(menuItems().includes('Open all in tabs (off)'));
  assert.ok(menuItems().includes('Sort “Empty” by name (off)'));
  closeMenu();

  pick('a');
  pick('b', { ctrlKey: true });
  rightClick('b');
  assert.deepEqual(selectedIds(), ['a', 'b']);
  assert.equal(menuItems()[0], 'Open 2 in new tabs');
  assert.ok(menuItems().includes('Properties… (off)'));
  closeMenu();

  rightClick();
  assert.deepEqual(selectedIds(), []);
  assert.deepEqual(menuItems().filter((t) => /Cut|Copy|Delete|Properties/.test(t)), ['Cut (off)', 'Copy (off)', 'Delete (off)', 'Properties… (off)']);
  closeMenu();
});

test('a new bookmark checks its address and goes just below the focused item', async () => {
  pick('a');
  rightClick('a');
  choose('New bookmark…');
  answer(false);
  await idle();
  assert.equal(dialog(), null);

  rightClick('a');
  choose('New bookmark…');
  assert.equal(dialogText(), 'New bookmark');
  answer(true, ['nope', 'Broken']);
  assert.equal(dialog().querySelector('.error').textContent, 'Enter a full URL, such as https://example.com/.');
  answer(true, ['https://new.test/', 'New one']);
  await idle(50);
  assert.deepEqual(await childTitles('menu________'), ['Alpha', 'New one', 'Beta', 'Gamma', 'Work', '']);
  assert.equal(lastToast(), 'Added “New one”.');
  const [created] = (await browser.bookmarks.getChildren('menu________')).filter((n) => n.title === 'New one');
  assert.deepEqual(selectedIds(), [created.id]);
  assert.equal(focusedId(), created.id);
});

test('a new folder goes at the top of a focused open folder', async () => {
  pick('menu________');
  rightClick('menu________');
  choose('New folder…');
  answer(false);
  await idle();
  rightClick('menu________');
  choose('New folder…');
  assert.equal(dialog().querySelector('input').value, 'New Folder');
  answer(true, ['Projects']);
  await idle(50);
  assert.deepEqual(await childTitles('menu________'), ['Projects', 'Alpha', 'New one', 'Beta', 'Gamma', 'Work', '']);
  assert.equal(lastToast(), 'Created “Projects”.');
  assert.equal(rowEl(focusedId()).textContent.includes('Projects'), true);
});

test('the organize button offers the same menu, and a new separator is off while the view is sorted', async () => {
  const name = () => document.querySelector('.bm-tree-head button');
  name().click();
  toolbarButton('Organize ▾').click();
  assert.ok(menuItems().includes('New separator (off)'));
  closeMenu();
  name().click();
  name().click();
  toolbarButton('Organize ▾').click();
  choose('New separator');
  await idle(50);
  const kids = await browser.bookmarks.getChildren('menu________');
  assert.deepEqual(kids.map((n) => n.type).slice(0, 2), ['folder', 'separator']);
  assert.equal(lastToast(), 'Added a separator.');
});

test('properties edits a bookmark’s name and address, or a folder’s name', async () => {
  pick('b');
  press('F2');
  assert.equal(dialogText(), 'Bookmark properties');
  answer(true, ['Bee', 'https://bee.test/']);
  await idle(50);
  const [bee] = await browser.bookmarks.get('b');
  assert.equal(bee.title, 'Bee');
  assert.equal(bee.url, 'https://bee.test/');
  assert.equal(lastToast(), 'Saved “Bee”.');

  pick('f1');
  press('Enter', { altKey: true });
  assert.equal(dialogText(), 'Folder properties');
  assert.equal(dialog().querySelectorAll('input').length, 1);
  answer(true, ['Job']);
  await idle(50);
  assert.equal((await browser.bookmarks.get('f1'))[0].title, 'Job');

  const count = toasts().length;
  pick('a');
  rightClick('a');
  choose('Properties…');
  answer(true);
  await idle();
  rightClick('a');
  choose('Properties…');
  answer(false);
  await idle();
  assert.equal(toasts().length, count);
  assert.equal((await browser.bookmarks.get('a'))[0].title, 'Alpha');

  pick('s1');
  press('F2');
  pick('menu________');
  press('F2');
  assert.equal(dialog(), null);
});

test('delete removes the selection and moves the focus to the next row, asking first for a full folder', async () => {
  pick('c');
  press('Delete');
  await idle(50);
  assert.ok(!(await childTitles('menu________')).includes('Gamma'));
  assert.equal(focusedId(), 'f1');
  assert.deepEqual(selectedIds(), ['f1']);
  assert.equal(lastToast(), 'Removed 1 item(s).');

  press('Delete');
  assert.equal(dialogText(), 'Remove 1 item(s), including the folder contents (2 item(s) directly inside)?');
  answer(false);
  await idle();
  assert.ok((await childTitles('menu________')).includes('Job'));
  press('Delete');
  answer(true);
  await idle(50);
  assert.ok(!(await childTitles('menu________')).includes('Job'));
  assert.equal(focusedId(), 's1');

  pick('menu________');
  press('Delete');
  await idle();
  assert.equal(dialog(), null);

  pick('e');
  rightClick('e');
  choose('Delete');
  await idle(50);
  assert.deepEqual(await childTitles('unfiled_____'), ['Zed']);
  assert.equal(focusedId(), 'z');
});

test('pasting with nothing copied adds nothing', async () => {
  pick('t1');
  const before = await childTitles('toolbar_____');
  fire(rowEl('t1'), 'paste', { clipboardData: { getData: () => 'just words' } });
  press('v', { ctrlKey: true });
  fire(rowEl('t1'), 'paste', {});
  await idle(80);
  assert.deepEqual(await childTitles('toolbar_____'), before);
});

test('copy and paste puts a copy below the focused row, by keys, the paste event or the menu', async () => {
  pick('a');
  press('c', { ctrlKey: true });
  pick('t1');
  press('v', { ctrlKey: true });
  await idle(100);
  assert.deepEqual(await childTitles('toolbar_____'), ['Tool', 'Alpha', 'Big']);
  assert.equal(lastToast(), 'Pasted 1 item(s).');

  pick('t1');
  press('v', { ctrlKey: true });
  fire(rowEl('t1'), 'paste', { clipboardData: { getData: () => 'https://alpha.test/' } });
  await idle(100);
  assert.deepEqual(await childTitles('toolbar_____'), ['Tool', 'Alpha', 'Alpha', 'Big']);

  pick('t1');
  fire(rowEl('t1'), 'paste', { clipboardData: { getData: () => 'https://x.test/ ftp://y.test/file nonsense http://' } });
  await idle(60);
  assert.deepEqual(await childTitles('toolbar_____'), ['Tool', 'https://x.test/', 'ftp://y.test/file', 'Alpha', 'Alpha', 'Big']);
  assert.equal(lastToast(), 'Added 2 bookmark(s).');

  pick('t1');
  fire(rowEl('t1'), 'paste', { clipboardData: { getData: () => 'plain words' } });
  await idle(60);
  assert.equal((await childTitles('toolbar_____'))[1], 'Alpha');

  pick('big');
  rightClick('big');
  choose('Paste');
  await idle(60);
  assert.deepEqual((await childTitles('toolbar_____')).slice(-2), ['Big', 'Alpha']);
});

test('cut marks the rows and paste moves them, but never into themselves', async () => {
  pick('menu________');
  press('x', { ctrlKey: true });
  rightClick('menu________');
  assert.ok(menuItems().includes('Paste'));
  closeMenu();

  pick('b');
  press('x', { ctrlKey: true });
  assert.ok(rowEl('b').classList.contains('cut'));
  pick('z');
  press('v', { ctrlKey: true });
  await idle(100);
  assert.deepEqual(await childTitles('unfiled_____'), ['Zed', 'Bee']);
  assert.equal(lastToast(), 'Moved 1 item(s) to “Other Bookmarks”.');
  assert.deepEqual(selectedIds(), ['b']);
  assert.ok(!rowEl('b').classList.contains('cut'));

  pick('big');
  press('x', { ctrlKey: true });
  press('ArrowRight');
  press('ArrowDown');
  assert.equal(focusedId(), 'g0');
  press('v', { ctrlKey: true });
  await idle(100);
  assert.equal(lastToast(), 'A folder cannot go inside itself.');
  assert.equal((await browser.bookmarks.get('big'))[0].parentId, 'toolbar_____');
  press('ArrowLeft');
  press('ArrowLeft');
});

test('a cut item removed before pasting is left out of the paste', async () => {
  pick('t1');
  press('x', { ctrlKey: true });
  await browser.bookmarks.remove('t1');
  await idle(600);
  pick('a');
  press('v', { ctrlKey: true });
  await idle(100);
  assert.ok(!(await childTitles('menu________')).includes('Tool'));
});

test('sort by name orders a folder’s contents, and undo and redo work from keys and the menu', async () => {
  rightClick('z');
  choose('Sort “Zed” by name');
  await idle(50);
  assert.deepEqual(await childTitles('z'), ['Ant', 'Zulu']);
  assert.equal(lastToast(), 'Sorted “Zed” by name.');

  pick('z');
  press('z', { ctrlKey: true });
  await idle(50);
  assert.deepEqual(await childTitles('z'), ['Zulu', 'Ant']);
  assert.equal(lastToast(), 'Undone: Sorted “Zed” by name');
  press('Z', { ctrlKey: true, shiftKey: true });
  await idle(50);
  assert.deepEqual(await childTitles('z'), ['Ant', 'Zulu']);
  press('z', { metaKey: true });
  await idle(50);
  press('y', { ctrlKey: true });
  await idle(50);
  assert.deepEqual(await childTitles('z'), ['Ant', 'Zulu']);

  rightClick('z');
  choose('Undo');
  await idle(50);
  assert.deepEqual(await childTitles('z'), ['Zulu', 'Ant']);
  rightClick('z');
  choose('Redo');
  await idle(50);
  assert.deepEqual(await childTitles('z'), ['Ant', 'Zulu']);
});

test('a folder can be ignored by every check and then included again', async () => {
  rightClick('z');
  choose('Ignore folder and everything inside');
  await idle(50);
  const { whitelist } = await browser.storage.local.get('whitelist');
  assert.equal(whitelist.z.title, 'Zed');
  assert.equal(whitelist.z.inside, true);
  assert.equal(lastToast(), 'Every check now skips “Zed” and everything inside it.');
  rightClick('z');
  choose('Stop ignoring this folder');
  await idle(50);
  assert.equal((await browser.storage.local.get('whitelist')).whitelist.z, undefined);
  assert.equal(lastToast(), 'Checks include “Zed” again.');
});

test('bookmarks open in tabs, a window or a private window, and failures explain why', async () => {
  browser.calls.length = 0;
  pick('a');
  pick('b', { ctrlKey: true });
  rightClick('a');
  choose('Open 2 in new tabs');
  await idle();
  assert.deepEqual(browser.calls, [
    ['tabs.create', { url: 'https://alpha.test/', active: false }],
    ['tabs.create', { url: 'https://bee.test/', active: false }],
  ]);
  rightClick('a');
  choose('Open in new window');
  await idle();
  assert.deepEqual(browser.calls.at(-1), ['windows.create', { url: ['https://alpha.test/', 'https://bee.test/'], incognito: false }]);
  rightClick('a');
  choose('Open in new private window');
  await idle();
  assert.deepEqual(browser.calls.at(-1), ['windows.create', { url: ['https://alpha.test/', 'https://bee.test/'], incognito: true }]);

  const { windows, tabs } = browser;
  const realCreate = windows.create;
  windows.create = async () => { throw new Error('not allowed'); };
  rightClick('a');
  choose('Open in new private window');
  await idle();
  assert.match(lastToast(), /^Could not open: not allowed\. Firefox may need this add-on allowed in private windows/);
  windows.create = realCreate;
  const realTab = tabs.create;
  tabs.create = async () => { throw 'blocked'; };
  pick('a');
  press('Enter');
  await idle();
  assert.match(lastToast(), /^Could not open: blocked\. Firefox does not let add-ons open some addresses/);
  tabs.create = realTab;
});

test('opening more than fifteen tabs asks first', async () => {
  browser.calls.length = 0;
  rightClick('big');
  choose('Open all in tabs');
  assert.equal(dialogText(), 'Open 16 tabs?');
  answer(false);
  await idle();
  assert.equal(browser.calls.length, 0);
  rightClick('big');
  choose('Open all in tabs');
  answer(true);
  await idle();
  assert.equal(browser.calls.length, 16);
  assert.equal(browser.calls[0][1].url, 'https://g.test/0');
});

test('open in container tab lists the containers, or says how to turn them on', async () => {
  pick('a');
  rightClick('a');
  choose('Open in new container tab…');
  await idle();
  assert.match(lastToast(), /^Turn on container tabs/);
  browser.contextualIdentities.query = async () => { throw new Error('off'); };
  rightClick('a');
  choose('Open in new container tab…');
  await idle();
  assert.match(lastToast(), /^Turn on container tabs/);
  browser.contextualIdentities.query = async () => [{ name: 'Work', cookieStoreId: 'firefox-container-1' }, { name: 'Shop', cookieStoreId: 'firefox-container-2' }];
  browser.calls.length = 0;
  rightClick('a');
  choose('Open in new container tab…');
  await idle();
  assert.deepEqual(menuItems(), ['Work', 'Shop']);
  choose('Shop');
  await idle();
  assert.deepEqual(browser.calls, [['tabs.create', { url: 'https://alpha.test/', active: true, cookieStoreId: 'firefox-container-2' }]]);
});

test('bookmark all tabs saves this window’s distinct real tabs into a new folder', async () => {
  pick('a');
  browser.permissions.request = async () => false;
  rightClick('a');
  choose('Bookmark all tabs…');
  await idle();
  assert.equal(lastToast(), 'Bookmarking tabs needs permission to read their addresses.');

  browser.permissions.request = async () => true;
  browser.tabs.query = async () => [{ url: 'about:blank' }, { url: 'moz-extension://test/src/ui/app.html' }, {}];
  rightClick('a');
  choose('Bookmark all tabs…');
  await idle();
  assert.equal(lastToast(), 'There are no tabs to bookmark in this window.');

  browser.tabs.query = async () => [
    { url: 'https://one.test/', title: 'One' }, { url: 'about:newtab' }, { url: 'https://one.test/', title: 'Again' },
    { url: 'https://two.test/' },
  ];
  rightClick('a');
  choose('Bookmark all tabs…');
  await idle();
  assert.equal(dialog().querySelector('label span').textContent, 'Bookmark 2 tab(s) in a new folder named');
  answer(false);
  await idle();
  rightClick('a');
  choose('Bookmark all tabs…');
  await idle();
  answer(true, ['Saved tabs']);
  await idle(50);
  const kids = await browser.bookmarks.getChildren('menu________');
  const folder = kids[kids.findIndex((n) => n.id === 'a') + 1];
  assert.equal(folder.title, 'Saved tabs');
  assert.deepEqual((await browser.bookmarks.getChildren(folder.id)).map((n) => [n.title, n.url]), [
    ['One', 'https://one.test/'], ['https://two.test/', 'https://two.test/'],
  ]);
  assert.equal(lastToast(), 'Bookmarked 2 tab(s) in “Saved tabs”.');
});

test('the context menu key and shift+F10 open the menu for the focused row', () => {
  pick('a');
  press('ArrowDown', { ctrlKey: true });
  const focused = focusedId();
  press('ContextMenu');
  assert.ok(menuOpen());
  assert.deepEqual(selectedIds(), [focused]);
  closeMenu();
  press('F10', { shiftKey: true });
  assert.ok(menuOpen());
  closeMenu();
  press('F10');
  assert.equal(menuOpen(), false);
  list().focus();
  rightClick();
  closeMenu();
});

test('show in folder leaves the search and reveals the item in its open folder', async () => {
  pick('z');
  press('ArrowLeft');
  searchBox().value = 'zulu';
  fire(searchBox(), 'input');
  assert.deepEqual(rowIds(), ['z2']);
  rightClick('z2');
  choose('Show in folder');
  assert.equal(searchBox().value, '');
  assert.ok(rowIds().includes('z2'));
  assert.equal(rowEl('z').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(selectedIds(), ['z2']);
  assert.equal(focusedId(), 'z2');
});

test('adding something while searching clears the search so the new item shows', async () => {
  searchBox().value = 'alpha';
  fire(searchBox(), 'input');
  pick('a');
  rightClick('a');
  choose('New folder…');
  answer(true, ['Found']);
  await idle(50);
  assert.equal(searchBox().value, '');
  assert.ok(rowIds().includes('menu________'));
  const kids = await childTitles('menu________');
  assert.equal(kids[kids.indexOf('Alpha') + 1], 'Found');
});

test('a failed change is reported and the page reloads', async () => {
  const real = browser.bookmarks.update;
  browser.bookmarks.update = async () => { throw new Error('locked'); };
  const quiet = console.error;
  console.error = () => {};
  pick('a');
  press('F2');
  answer(true, ['Changed']);
  await idle(50);
  console.error = quiet;
  browser.bookmarks.update = real;
  assert.equal(lastToast(), 'Something went wrong: locked');
});
