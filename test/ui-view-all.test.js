import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom, settle } from './browser-env.js';
import {
  startAll, idle, list, rows, rowIds, rowEl, selectedIds, focusedId, statusText, headLabels, searchBox, filterBox,
  toolbarButton, lastToast, label, cell, fire, mousedown, click, press, pick, menuItems, choose, closeMenu,
} from './ui-view-all-helpers.js';

const DAY = 86400000;
const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'a', title: 'Alpha', url: 'https://alpha.test/', dateAdded: 3 * DAY },
    { id: 'f1', title: 'Work', dateAdded: DAY, children: [
      { id: 'w1', title: 'Wiki', url: 'https://wiki.test/', dateAdded: 5 * DAY },
      { id: 'deep', title: 'Deep', dateAdded: DAY, children: [
        { id: 'd1', title: 'Docs', url: 'https://docs.test/', dateAdded: 2 * DAY },
      ] },
    ] },
    { id: 's1', type: 'separator', dateAdded: DAY },
    { id: 'b', title: 'Beta', url: 'https://beta.test/', dateAdded: 4 * DAY },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [
    { id: 't1', title: 'Tool', url: 'https://tool.test/', dateAdded: 6 * DAY },
    { id: 't2', title: 'Alpha again', url: 'https://alpha.test/', dateAdded: 7 * DAY },
  ] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [
    { id: 'u', title: '', url: 'https://untitled.test/', dateAdded: 8 * DAY },
    { id: 'nf', title: '', dateAdded: DAY, children: [] },
    { id: 'many', title: 'Many', dateAdded: DAY, children: Array.from({ length: 205 }, (_, i) => ({ id: `m${i}`, title: `Item ${i}`, url: `https://many.test/${i}`, dateAdded: DAY })) },
  ] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

before(async () => {
  await startAll(tree());
});
after(uninstallDom);

test('the tree shows the roots and their open folders, but not an empty mobile folder', () => {
  assert.deepEqual(rowIds(), ['menu________', 'a', 'f1', 's1', 'b', 'toolbar_____', 't1', 't2', 'unfiled_____', 'u', 'nf', 'many']);
  assert.equal(rowEl('a').getAttribute('aria-level'), '2');
  assert.equal(rowEl('menu________').getAttribute('aria-expanded'), 'true');
  assert.equal(rowEl('f1').getAttribute('aria-expanded'), 'false');
  assert.equal(rowEl('menu________').getAttribute('draggable'), null);
  assert.equal(rowEl('a').getAttribute('draggable'), 'true');
  assert.equal(rowEl('s1').querySelector('.sep-line').getAttribute('aria-label'), 'Separator');
  assert.equal(label('u'), 'https://untitled.test/');
  assert.ok(rowEl('u').querySelector('.bm-label').classList.contains('untitled'));
  assert.equal(label('nf'), '(no name)');
  assert.equal(cell('a', 'location'), 'https://alpha.test/');
  assert.equal(cell('s1', 'added'), '');
  assert.notEqual(cell('a', 'added'), '');
  assert.deepEqual(headLabels(), ['Name', 'Location', 'Added']);
  assert.equal(statusText(), '212 bookmarks in 8 folders');
  assert.equal(rowEl('menu________').tabIndex, 0);
});

test('the twisty opens and closes a folder and the open folders are remembered', () => {
  mousedown(rowEl('f1').querySelector('.twisty'));
  assert.deepEqual(rowIds().slice(0, 6), ['menu________', 'a', 'f1', 'w1', 'deep', 's1']);
  assert.equal(rowEl('f1').getAttribute('aria-expanded'), 'true');
  assert.equal(focusedId(), 'f1');
  assert.ok(JSON.parse(localStorage.getItem('all.expanded')).includes('f1'));
  mousedown(rowEl('f1').querySelector('.twisty'));
  assert.equal(rowEl('w1'), null);
  assert.ok(!JSON.parse(localStorage.getItem('all.expanded')).includes('f1'));
});

test('arrow, Home and End keys move the selection and focus row by row', () => {
  pick('a');
  assert.deepEqual(selectedIds(), ['a']);
  assert.equal(focusedId(), 'a');
  press('ArrowDown');
  assert.deepEqual(selectedIds(), ['f1']);
  assert.equal(focusedId(), 'f1');
  press('ArrowUp');
  assert.equal(focusedId(), 'a');
  press('End');
  assert.equal(focusedId(), 'many');
  press('Home');
  assert.equal(focusedId(), 'menu________');
  assert.equal(statusText(), '212 bookmarks in 8 folders · 1 selected');
  press('PageDown');
  assert.equal(focusedId(), 'many');
  press('PageUp');
  assert.equal(focusedId(), 'menu________');
  press('ArrowUp');
  assert.equal(focusedId(), 'menu________');
});

test('shift extends the selection and ctrl moves the focus without changing it', () => {
  pick('a');
  press('ArrowDown', { shiftKey: true });
  press('ArrowDown', { shiftKey: true });
  assert.deepEqual(selectedIds(), ['a', 'f1', 's1']);
  press('ArrowDown', { ctrlKey: true });
  assert.equal(focusedId(), 'b');
  assert.deepEqual(selectedIds(), ['a', 'f1', 's1']);
  press(' ', { ctrlKey: true });
  assert.deepEqual(selectedIds(), ['a', 'f1', 's1', 'b']);
  press(' ', { ctrlKey: true });
  assert.deepEqual(selectedIds(), ['a', 'f1', 's1']);
  assert.match(statusText(), /· 3 selected$/);
});

test('right and left arrows open a folder, step into it, and step back out and close it', () => {
  pick('f1');
  press('ArrowRight');
  assert.equal(rowEl('f1').getAttribute('aria-expanded'), 'true');
  assert.equal(focusedId(), 'f1');
  press('ArrowRight');
  assert.equal(focusedId(), 'w1');
  press('ArrowLeft');
  assert.equal(focusedId(), 'f1');
  press('ArrowLeft');
  assert.equal(rowEl('f1').getAttribute('aria-expanded'), 'false');
  assert.equal(focusedId(), 'f1');
  press('ArrowLeft');
  assert.equal(focusedId(), 'menu________');
  press('ArrowLeft');
  assert.equal(rowEl('menu________').getAttribute('aria-expanded'), 'false');
  press('ArrowLeft');
  assert.equal(focusedId(), 'menu________');
  press('ArrowRight');
  assert.equal(rowEl('menu________').getAttribute('aria-expanded'), 'true');
});

test('star opens a folder and every folder inside it', () => {
  pick('f1');
  press('*');
  assert.deepEqual(rowIds().slice(2, 7), ['f1', 'w1', 'deep', 'd1', 's1']);
});

test('closing a folder drops the selection inside it and moves the focus to the folder', () => {
  pick('w1');
  pick('d1', { ctrlKey: true });
  mousedown(rowEl('f1').querySelector('.twisty'));
  assert.deepEqual(selectedIds(), []);
  assert.equal(focusedId(), 'f1');
});

test('typing letters jumps to the next row whose name starts with them', async () => {
  pick('menu________');
  press('b');
  assert.equal(focusedId(), 'b');
  press('o');
  assert.equal(focusedId(), 'toolbar_____');
  await settle(850);
  press('a');
  assert.equal(focusedId(), 't2');
  press('z');
  assert.equal(focusedId(), 't2');
});

test('ctrl-click toggles rows, shift-click selects a range and a click narrows a multiple selection', () => {
  pick('a');
  pick('b', { ctrlKey: true });
  assert.deepEqual(selectedIds(), ['a', 'b']);
  pick('a', { metaKey: true });
  assert.deepEqual(selectedIds(), ['b']);
  pick('t1', { shiftKey: true });
  assert.deepEqual(selectedIds(), ['a', 'f1', 's1', 'b', 'toolbar_____', 't1']);
  mousedown(rowEl('t1'));
  assert.equal(selectedIds().length, 6);
  click(rowEl('t1'));
  assert.deepEqual(selectedIds(), ['t1']);
  mousedown(rowEl('a'), { button: 2 });
  assert.deepEqual(selectedIds(), ['t1']);
  press('a', { ctrlKey: true });
  assert.equal(selectedIds().length, rows().length);
});

test('a click outside any row and a key from outside a row change nothing', () => {
  pick('a');
  mousedown(list());
  click(list());
  fire(list(), 'dblclick', {}, MouseEvent);
  fire(list(), 'auxclick', { button: 1 }, MouseEvent);
  assert.deepEqual(selectedIds(), ['a']);
  const extra = document.createElement('span');
  list().append(extra);
  press('ArrowDown', {}, extra);
  assert.equal(focusedId(), 'a');
  extra.remove();
  assert.equal(press('Tab').defaultPrevented, false);
});

test('expand all opens every folder and collapse all closes them, keeping the focus on the top folder', () => {
  toolbarButton('Expand all').click();
  assert.ok(rowIds().includes('d1'));
  assert.ok(rowIds().includes('m204'));
  pick('d1');
  toolbarButton('Collapse all').click();
  assert.deepEqual(rowIds(), ['menu________', 'toolbar_____', 'unfiled_____']);
  assert.deepEqual(selectedIds(), ['menu________']);
  assert.equal(focusedId(), 'menu________');
  toolbarButton('Collapse all').click();
  assert.equal(focusedId(), 'menu________');
  for (const id of ['menu________', 'toolbar_____', 'unfiled_____']) mousedown(rowEl(id).querySelector('.twisty'));
  assert.equal(rowIds().length, 12);
});

test('the name header sorts each folder by name, reverses, then returns to the saved order', () => {
  const name = () => document.querySelector('.bm-tree-head button');
  name().click();
  assert.equal(name().getAttribute('aria-sort'), 'ascending');
  assert.match(name().textContent, /▲/);
  assert.deepEqual(rowIds().slice(0, 4), ['menu________', 'a', 'b', 'f1']);
  assert.ok(!rowIds().includes('s1'));
  name().click();
  assert.equal(name().getAttribute('aria-sort'), 'descending');
  assert.deepEqual(rowIds().slice(0, 4), ['unfiled_____', 'many', 'u', 'nf']);
  name().click();
  assert.equal(name().getAttribute('aria-sort'), null);
  assert.equal(rowIds()[0], 'menu________');
  assert.ok(rowIds().includes('s1'));
});

test('the location and added headers sort by address and by date', () => {
  const header = (text) => [...document.querySelectorAll('.bm-tree-head button')].find((b) => b.textContent.startsWith(text));
  header('Location').click();
  assert.deepEqual(rowIds().slice(0, 4), ['menu________', 'f1', 'a', 'b']);
  header('Added').click();
  assert.deepEqual(rowIds().slice(0, 4), ['menu________', 'f1', 'a', 'b']);
  header('Added').click();
  assert.deepEqual(rowIds().slice(0, 4), ['menu________', 'b', 'a', 'f1']);
  header('Added').click();
  assert.equal(rowIds()[3], 's1');
});

test('the columns menu hides and shows a column and turning off a sorted column drops the sort', () => {
  const header = (text) => [...document.querySelectorAll('.bm-tree-head button')].find((b) => b.textContent.startsWith(text));
  header('Location').click();
  toolbarButton('Columns ▾').click();
  assert.deepEqual(menuItems(), ['Location', 'Added', 'Most recent visit', 'Visit count']);
  assert.equal(document.querySelector('dialog.menu button').getAttribute('aria-checked'), 'true');
  choose('Location');
  assert.deepEqual(headLabels(), ['Name', 'Added']);
  assert.equal(rowEl('a').querySelector('.cell.location'), null);
  assert.equal(rowIds()[3], 's1');
  assert.equal(localStorage.getItem('all.columns'), JSON.stringify({ location: false, added: true, visited: false, visits: false }));
  toolbarButton('Columns ▾').click();
  choose('Location');
  assert.deepEqual(headLabels(), ['Name', 'Location', 'Added']);
});

test('visit columns ask for history access and show each bookmark’s visits', async () => {
  const now = Date.now();
  browser.history.search = async () => [
    { url: 'https://alpha.test/', lastVisitTime: now, visitCount: 5 },
    { url: 'https://beta.test/', lastVisitTime: now - DAY, visitCount: 2 },
    { url: 'https://tool.test/' },
  ];
  browser.permissions.request = async () => false;
  toolbarButton('Columns ▾').click();
  choose('Visit count');
  await idle();
  assert.equal(lastToast(), 'Visit columns need permission to read your browsing history.');
  assert.deepEqual(headLabels(), ['Name', 'Location', 'Added']);

  browser.permissions.request = async () => true;
  toolbarButton('Columns ▾').click();
  choose('Visit count');
  await idle();
  toolbarButton('Columns ▾').click();
  choose('Most recent visit');
  await idle();
  assert.deepEqual(headLabels(), ['Name', 'Location', 'Added', 'Most recent visit', 'Visit count']);
  assert.equal(cell('a', 'visits'), '5');
  assert.equal(cell('t1', 'visits'), '0');
  assert.equal(cell('f1', 'visits'), '');
  assert.notEqual(cell('a', 'visited'), '');
  assert.equal(cell('t2', 'visits'), '5');

  const header = (text) => [...document.querySelectorAll('.bm-tree-head button')].find((b) => b.textContent.startsWith(text));
  header('Visit count').click();
  header('Visit count').click();
  assert.deepEqual(rowIds().slice(0, 4), ['menu________', 'a', 'b', 'f1']);
  header('Most recent visit').click();
  assert.deepEqual(rowIds().slice(0, 4), ['menu________', 'f1', 'b', 'a']);

  pick('a');
  assert.match(document.querySelector('.details-meta').textContent, /Last visited .* · 5 visit\(s\)/);
  pick('t1');
  pick('u');
  assert.match(document.querySelector('.details-meta').textContent, /Never visited/);

  toolbarButton('Columns ▾').click();
  choose('Most recent visit');
  await idle();
  toolbarButton('Columns ▾').click();
  choose('Visit count');
  await idle();
  assert.deepEqual(headLabels(), ['Name', 'Location', 'Added']);
});

test('history that cannot be read counts every bookmark as never visited', async () => {
  browser.history.search = async () => { throw new Error('no history'); };
  const real = Date.now;
  Date.now = () => real() + 120000;
  toolbarButton('Columns ▾').click();
  choose('Visit count');
  await idle();
  Date.now = real;
  assert.equal(cell('a', 'visits'), '0');
  toolbarButton('Columns ▾').click();
  choose('Visit count');
  await idle();
});

test('searching lists matches by name, address or folder with a folder column', () => {
  const box = searchBox();
  box.value = 'alpha';
  fire(box, 'input');
  assert.deepEqual(rowIds(), ['a', 't2']);
  assert.deepEqual(headLabels(), ['Name', 'Location', 'Folder', 'Added']);
  assert.equal(cell('t2', 'where'), 'Bookmarks Toolbar');
  assert.match(statusText(), /^2 found/);
  assert.ok(list().classList.contains('searching'));
  assert.equal(rowEl('a').getAttribute('aria-level'), '1');
  assert.equal(rowEl('a').getAttribute('aria-expanded'), null);

  searchBox().value = 'Deep';
  fire(searchBox(), 'input');
  assert.deepEqual(rowIds(), ['deep', 'd1']);
  assert.ok(rowEl('deep').querySelector('.twisty').classList.contains('none'));

  searchBox().value = 'nothing at all';
  fire(searchBox(), 'input');
  assert.deepEqual(rowIds(), []);
  assert.equal(list().textContent, 'Nothing matches.');
  assert.match(statusText(), /^0 found/);
});

test('down arrow in the search box moves into the results', () => {
  searchBox().value = 'beta';
  fire(searchBox(), 'input');
  fire(searchBox(), 'keydown', { key: 'ArrowDown' }, KeyboardEvent);
  assert.deepEqual(selectedIds(), ['b']);
  assert.equal(focusedId(), 'b');
  pick('b');
  searchBox().focus();
  fire(searchBox(), 'keydown', { key: 'ArrowDown' }, KeyboardEvent);
  assert.equal(focusedId(), 'b');
  fire(searchBox(), 'keydown', { key: 'a' }, KeyboardEvent);
  searchBox().value = 'zzz';
  fire(searchBox(), 'input');
  fire(searchBox(), 'keydown', { key: 'ArrowDown' }, KeyboardEvent);
  assert.deepEqual(rowIds(), []);
});

test('in search results arrows do not open folders and enter does not toggle them', () => {
  searchBox().value = 'Work';
  fire(searchBox(), 'input');
  pick('f1');
  press('ArrowRight');
  press('ArrowLeft');
  press('Enter');
  press('*');
  fire(rowEl('f1'), 'dblclick', {}, MouseEvent);
  assert.deepEqual(rowIds(), ['f1', 'w1', 'deep', 'd1']);
  assert.ok(!browser.calls.some(([name]) => name === 'tabs.create'));
});

test('long search results show 200 rows with a button for more', () => {
  searchBox().value = 'item';
  fire(searchBox(), 'input');
  const more = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Show more');
  assert.equal(rows().length, 200);
  assert.equal(more.hidden, false);
  assert.match(statusText(), /^205 found/);
  more.click();
  assert.equal(rows().length, 205);
  assert.equal(more.hidden, true);
});

test('the show filter picks duplicates, non-duplicates or the newest bookmarks first', () => {
  searchBox().value = '';
  fire(searchBox(), 'input');
  filterBox().value = 'dupes';
  fire(filterBox(), 'change');
  assert.deepEqual(rowIds().sort(), ['a', 't2']);
  filterBox().value = 'unique';
  fire(filterBox(), 'change');
  assert.ok(!rowIds().includes('a'));
  assert.ok(!rowIds().includes('f1'));
  assert.ok(rowIds().includes('b'));
  filterBox().value = 'recent';
  fire(filterBox(), 'change');
  assert.deepEqual(rowIds().slice(0, 5), ['u', 't2', 't1', 'w1', 'b']);
  const name = () => document.querySelector('.bm-tree-head button');
  name().click();
  assert.deepEqual(rowIds().slice(0, 3), ['u', 'a', 't2']);
  name().click();
  name().click();
  filterBox().value = 'all';
  fire(filterBox(), 'change');
  assert.equal(rowIds()[0], 'menu________');
});

test('the details pane edits the selected bookmark’s name and address in place', async () => {
  const pane = () => document.querySelector('.details-pane');
  pick('menu________');
  pick('menu________', { ctrlKey: true });
  assert.equal(pane().textContent, 'Select a bookmark or folder to see and edit its details.');
  pick('a');
  pick('b', { ctrlKey: true });
  assert.equal(pane().textContent, '2 items selected.');
  pick('menu________');
  assert.equal(pane().querySelector('.details-title').textContent, 'Bookmarks Menu');
  assert.equal(pane().querySelector('input'), null);
  pick('s1');
  assert.equal(pane().querySelector('.details-title').textContent, 'Separator');

  pick('b');
  const [name, url] = pane().querySelectorAll('input');
  assert.equal(name.value, 'Beta');
  assert.equal(url.value, 'https://beta.test/');
  assert.match(pane().querySelector('.details-meta').textContent, /Bookmarks Menu.*Added/);

  url.value = 'not a url';
  fire(pane().querySelector('form'), 'change');
  const error = pane().querySelector('.error');
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, 'Enter a full URL, such as https://example.com/.');
  fire(pane().querySelector('form'), 'keydown', { key: 'Escape' }, KeyboardEvent);
  assert.equal(url.value, 'https://beta.test/');
  assert.equal(error.hidden, true);
  fire(pane().querySelector('form'), 'keydown', { key: 'x' }, KeyboardEvent);

  name.value = '  Beta two ';
  fire(pane().querySelector('form'), 'change');
  fire(pane().querySelector('form'), 'submit');
  await idle();
  const [node] = await browser.bookmarks.get('b');
  assert.equal(node.title, 'Beta two');
  assert.equal(lastToast(), 'Saved “Beta two”.');
  assert.equal(label('b'), 'Beta two');
  assert.equal(focusedId(), 'b');
});

test('renaming a folder in the details pane keeps its address-free form', async () => {
  pick('f1');
  const pane = document.querySelector('.details-pane');
  assert.equal(pane.querySelectorAll('input').length, 1);
  pane.querySelector('input').value = 'Job';
  fire(pane.querySelector('form'), 'change');
  await idle();
  assert.equal((await browser.bookmarks.get('f1'))[0].title, 'Job');
  pick('f1');
  fire(document.querySelector('.details-pane form'), 'change');
  fire(document.querySelector('.details-pane form'), 'keydown', { key: 'Escape' }, KeyboardEvent);
  await idle();
  assert.equal((await browser.bookmarks.get('f1'))[0].title, 'Job');
});

test('double-click and enter open a bookmark in a tab, or toggle a folder', async () => {
  browser.calls.length = 0;
  fire(rowEl('f1'), 'dblclick', {}, MouseEvent);
  assert.equal(rowEl('f1').getAttribute('aria-expanded'), 'true');
  fire(rowEl('f1').querySelector('.twisty'), 'dblclick', {}, MouseEvent);
  assert.equal(rowEl('f1').getAttribute('aria-expanded'), 'true');
  fire(rowEl('f1'), 'dblclick', {}, MouseEvent);
  fire(rowEl('a'), 'dblclick', {}, MouseEvent);
  await idle();
  assert.deepEqual(browser.calls.at(-1), ['tabs.create', { url: 'https://alpha.test/', active: true }]);
  pick('b');
  press('Enter', { shiftKey: true });
  await idle();
  assert.deepEqual(browser.calls.at(-1), ['windows.create', { url: ['https://beta.test/'], incognito: false }]);
  press('Enter', { ctrlKey: true });
  await idle();
  assert.deepEqual(browser.calls.at(-1), ['tabs.create', { url: 'https://beta.test/', active: true }]);
  pick('s1');
  press('Enter');
  await idle();
  assert.equal(browser.calls.length, 3);
});

test('a middle click opens a bookmark, or every bookmark directly in a folder, in tabs', async () => {
  browser.calls.length = 0;
  fire(rowEl('t1'), 'auxclick', { button: 1 }, MouseEvent);
  fire(rowEl('t1'), 'auxclick', { button: 2 }, MouseEvent);
  fire(rowEl('toolbar_____'), 'auxclick', { button: 1 }, MouseEvent);
  fire(rowEl('s1'), 'auxclick', { button: 1 }, MouseEvent);
  await idle();
  assert.deepEqual(browser.calls.map(([, props]) => props.url), ['https://tool.test/', 'https://tool.test/', 'https://alpha.test/']);
  assert.deepEqual(browser.calls.map(([, props]) => props.active), [true, false, false]);
});

test('focus leaving the tree for another control stops it reclaiming the focus after a re-render', async () => {
  pick('a');
  fire(rowEl('a'), 'focusout', { relatedTarget: searchBox() }, FocusEvent);
  fire(rowEl('a'), 'focusout', { relatedTarget: rowEl('b') }, FocusEvent);
  fire(rowEl('a'), 'focusout', {}, FocusEvent);
  fire(rowEl('a'), 'focusout', { relatedTarget: searchBox() }, FocusEvent);
  searchBox().focus();
  document.querySelector('[data-action=reload]').click();
  await idle(50);
  assert.equal(document.activeElement.dataset?.id, undefined);
  assert.deepEqual(selectedIds(), ['a']);
  closeMenu();
});
