import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom, settle } from './browser-env.js';
import {
  startAll, idle, list, rowIds, rowEl, selectedIds, searchBox, toolbarButton, lastToast,
  fire, pick, press, menuItems, choose, dialog, dialogText, answer, transfer, sized, childTitles, captureDownloads,
} from './ui-view-all-helpers.js';

const DRAG = 'application/x-bookmark-manager-ids';
const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'a', title: 'Alpha', url: 'https://alpha.test/' },
    { id: 'b', title: 'Beta', url: 'https://beta.test/' },
    { id: 'c', title: '', url: 'https://gamma.test/' },
    { id: 'f1', title: 'Work', children: [{ id: 'w1', title: 'Wiki', url: 'https://wiki.test/' }] },
    { id: 'cl', title: 'Closed', children: [{ id: 'x1', title: 'Inside', url: 'https://inside.test/' }] },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [{ id: 't1', title: 'Tool', url: 'https://tool.test/' }] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [{ id: 'p1', title: 'Phone', url: 'https://phone.test/' }] },
];

// Drags a row onto another; `y` is the pointer's height within the 20px target row.
function drag(fromId, toId, y, props = {}) {
  const dt = transfer();
  const start = fire(rowEl(fromId), 'dragstart', { dataTransfer: dt });
  const target = toId && sized(rowEl(toId));
  const over = target && fire(target, 'dragover', { dataTransfer: dt, clientY: y, ...props });
  const marks = target ? [...target.classList].filter((c) => c.startsWith('drop-')) : [];
  const drop = target && fire(target, 'drop', { dataTransfer: dt, clientY: y, ...props });
  fire(list(), 'dragend', { dataTransfer: dt });
  return { dt, start, over, marks, drop };
}

before(async () => {
  await startAll(tree(), { saved: { 'all.expanded': ['menu________', 'toolbar_____', 'f1'] } });
});
after(uninstallDom);

test('a non-empty mobile folder shows, and the open folders come from the saved list', () => {
  assert.deepEqual(rowIds(), ['menu________', 'a', 'b', 'c', 'f1', 'w1', 'cl', 'toolbar_____', 't1', 'unfiled_____', 'mobile______']);
});

test('dragging a bookmark carries its address for other apps and drops below the lower half of a row', async () => {
  const { dt, start, over, marks } = drag('a', 'c', 15);
  assert.equal(start.defaultPrevented, false);
  assert.deepEqual(JSON.parse(dt.store[DRAG]), ['a']);
  assert.equal(dt.store['text/x-moz-url'], 'https://alpha.test/\nAlpha');
  assert.equal(dt.store['text/uri-list'], 'https://alpha.test/');
  assert.equal(dt.store['text/plain'], 'https://alpha.test/');
  assert.equal(dt.effectAllowed, 'copyMove');
  assert.equal(over.defaultPrevented, true);
  assert.equal(dt.dropEffect, 'move');
  assert.deepEqual(marks, ['drop-after']);
  await idle(50);
  assert.deepEqual(await childTitles('menu________'), ['Beta', '', 'Alpha', 'Work', 'Closed']);
  assert.equal(lastToast(), 'Moved 1 item(s) to “Bookmarks Menu”.');
  assert.deepEqual(selectedIds(), ['a']);
});

test('a drop on the upper half of a row goes above it', async () => {
  const { dt, marks } = drag('c', 'b', 2);
  assert.equal(dt.store['text/x-moz-url'], 'https://gamma.test/\nhttps://gamma.test/');
  assert.deepEqual(marks, ['drop-before']);
  await idle(50);
  assert.deepEqual(await childTitles('menu________'), ['', 'Beta', 'Alpha', 'Work', 'Closed']);
});

test('a folder takes a drop in its middle, and its edges drop beside it or at the top of its open contents', async () => {
  assert.deepEqual(drag('b', 'f1', 10).marks, ['drop-into']);
  await idle(50);
  assert.deepEqual(await childTitles('f1'), ['Wiki', 'Beta']);
  assert.deepEqual(drag('a', 'f1', 18).marks, ['drop-after']);
  await idle(50);
  assert.deepEqual(await childTitles('f1'), ['Alpha', 'Wiki', 'Beta']);
  assert.deepEqual(drag('a', 'cl', 2).marks, ['drop-before']);
  await idle(50);
  assert.deepEqual(await childTitles('menu________'), ['', 'Work', 'Alpha', 'Closed']);
  assert.deepEqual(drag('a', 'cl', 18).marks, ['drop-after']);
  await idle(50);
  assert.deepEqual(await childTitles('menu________'), ['', 'Work', 'Closed', 'Alpha']);
});

test('ctrl-drop copies instead of moving', async () => {
  const { dt } = drag('t1', 'a', 15, { ctrlKey: true });
  assert.equal(dt.dropEffect, 'copy');
  await idle(50);
  assert.deepEqual(await childTitles('menu________'), ['', 'Work', 'Closed', 'Alpha', 'Tool']);
  assert.deepEqual(await childTitles('toolbar_____'), ['Tool']);
  assert.equal(lastToast(), 'Copied 1 item(s).');
});

test('a folder cannot be dropped into itself or its contents, and a top folder cannot be dragged', async () => {
  const self = drag('f1', 'f1', 10);
  assert.equal(self.dt.store['text/x-moz-url'], undefined);
  assert.equal(self.over.defaultPrevented, false);
  assert.deepEqual(self.marks, []);
  const inner = drag('f1', 'w1', 15);
  assert.equal(inner.over.defaultPrevented, false);
  await idle(50);
  assert.equal((await browser.bookmarks.get('f1'))[0].parentId, 'menu________');
  const top = drag('menu________', null);
  assert.equal(top.start.defaultPrevented, true);
});

test('dragging over the empty list or with nothing dragged marks nothing', () => {
  fire(list(), 'dragover', { dataTransfer: transfer() });
  const over = fire(sized(rowEl('a')), 'dragover', { dataTransfer: transfer({ Files: '' }), clientY: 5 });
  assert.equal(over.defaultPrevented, false);
  fire(list(), 'drop', { dataTransfer: transfer() });
  fire(document.createElement('span'), 'dragstart', { dataTransfer: transfer() });
  const stray = document.createElement('span');
  list().append(stray);
  fire(stray, 'dragstart', { dataTransfer: transfer() });
  stray.remove();
  assert.equal(list().querySelectorAll('.drop-before, .drop-after, .drop-into').length, 0);
});

test('holding a drag over a closed folder opens it, and leaving the list clears the marks', async () => {
  await settle(600);
  const dt = transfer();
  fire(rowEl('t1'), 'dragstart', { dataTransfer: dt });
  const closed = sized(rowEl('cl'));
  fire(closed, 'dragover', { dataTransfer: dt, clientY: 10 });
  fire(closed, 'dragover', { dataTransfer: dt, clientY: 10 });
  assert.ok(closed.classList.contains('drop-into'));
  fire(list(), 'dragleave', { relatedTarget: rowEl('a') });
  assert.ok(closed.classList.contains('drop-into'));
  fire(list(), 'dragleave', { relatedTarget: null });
  assert.ok(!closed.classList.contains('drop-into'));
  fire(sized(rowEl('a')), 'dragover', { dataTransfer: dt, clientY: 5 });
  fire(closed, 'dragover', { dataTransfer: dt, clientY: 10 });
  await settle(850);
  assert.equal(rowEl('cl').getAttribute('aria-expanded'), 'true');
  assert.ok(rowIds().includes('x1'));
  fire(list(), 'dragend', {});
});

test('a folder held under a drag still opens when the page redraws during the hold', async () => {
  await settle(600);
  fire(list(), 'dragleave', { relatedTarget: null });
  pick('cl');
  press('ArrowLeft');
  assert.equal(rowEl('cl').getAttribute('aria-expanded'), 'false');
  const link = transfer({ 'text/uri-list': 'https://held.test/' });
  fire(sized(rowEl('cl')), 'dragover', { dataTransfer: link, clientY: 10 });
  window.dispatchEvent(new Event('hashchange'));
  await settle(400);
  fire(sized(rowEl('cl')), 'dragover', { dataTransfer: link, clientY: 10 });
  await settle(850);
  assert.equal(rowEl('cl').getAttribute('aria-expanded'), 'true');
  fire(list(), 'dragleave', { relatedTarget: null });
});

test('links dragged in from outside become new bookmarks where they land', async () => {
  const moz = transfer({ 'text/x-moz-url': 'https://new.test/\nNew page\nnot a url\nBad\nhttps://bare.test/' });
  const over = fire(sized(rowEl('w1')), 'dragover', { dataTransfer: moz, clientY: 15 });
  assert.equal(moz.dropEffect, 'copy');
  assert.equal(over.defaultPrevented, true);
  fire(rowEl('w1'), 'drop', { dataTransfer: moz, clientY: 15 });
  await idle(50);
  const titles = await childTitles('f1');
  assert.deepEqual(titles.slice(titles.indexOf('Wiki'), titles.indexOf('Wiki') + 3), ['Wiki', 'New page', 'https://bare.test/']);
  assert.equal(lastToast(), 'Added 2 bookmark(s).');

  const uris = transfer({ 'text/uri-list': '# a comment\r\nhttps://u.test/\r\n' });
  fire(sized(rowEl('toolbar_____')), 'drop', { dataTransfer: uris, clientY: 10 });
  await idle(50);
  assert.deepEqual(await childTitles('toolbar_____'), ['Tool', 'https://u.test/']);

  const junk = transfer({ 'text/uri-list': 'nothing useful' });
  fire(sized(rowEl('t1')), 'drop', { dataTransfer: junk, clientY: 10 });
  await idle(50);
  assert.deepEqual(await childTitles('toolbar_____'), ['Tool', 'https://u.test/']);
});

test('sorted views and search results only take drops into folders', async () => {
  const name = () => document.querySelector('.bm-tree-head button');
  name().click();
  const onBookmark = drag('a', 't1', 15);
  assert.equal(onBookmark.over.defaultPrevented, false);
  assert.deepEqual(onBookmark.marks, []);
  assert.deepEqual(drag('a', 'toolbar_____', 2).marks, ['drop-into']);
  await idle(50);
  assert.deepEqual(await childTitles('toolbar_____'), ['Tool', 'https://u.test/', 'Alpha']);
  name().click();
  name().click();

  searchBox().value = 'o';
  fire(searchBox(), 'input');
  assert.deepEqual(drag('t1', 'cl', 2).marks, ['drop-into']);
  await idle(50);
  assert.ok((await childTitles('cl')).includes('Tool'));
  assert.equal(searchBox().value, 'o');
  searchBox().value = '';
  fire(searchBox(), 'input');
});

test('export to HTML saves every bookmark as a bookmarks file', async () => {
  const saved = captureDownloads();
  toolbarButton('Import and backup ▾').click();
  assert.deepEqual(menuItems(), ['Export bookmarks to HTML…', 'Import bookmarks from HTML…', 'Back up to JSON…', 'Restore from JSON backup…']);
  choose('Export bookmarks to HTML…');
  assert.equal(location.hash, '#all');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].type, 'text/html');
  const html = await saved[0].text();
  assert.match(html, /<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
  assert.match(html, /https:\/\/wiki\.test\//);
});

test('importing an HTML file asks, then adds its bookmarks in a new folder in Other Bookmarks', async () => {
  const [htmlInput] = document.querySelectorAll('.tree-toolbar input[type=file]');
  const upload = (input, files) => {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    fire(input, 'change');
  };
  toolbarButton('Import and backup ▾').click();
  choose('Import bookmarks from HTML…');

  upload(htmlInput, []);
  upload(htmlInput, [new File(['<p>no links</p>'], 'empty.html')]);
  await idle();
  assert.equal(lastToast(), 'No bookmarks found in that file.');

  const file = new File(['<DL><p><DT><A HREF="https://imported.test/">Imported page</A><DT><H3>Sub</H3><DL><p><DT><A HREF="https://sub.test/">Sub page</A></DL></DL>'], 'b.html');
  upload(htmlInput, [file]);
  await idle();
  assert.match(dialogText(), /^Import 2 bookmark\(s\) into a new folder “Imported .*” in Other Bookmarks\?$/);
  answer(false);
  await idle();
  assert.deepEqual(await childTitles('unfiled_____'), []);
  upload(htmlInput, [file]);
  await idle();
  answer(true);
  await idle(50);
  const [folder] = await browser.bookmarks.getChildren('unfiled_____');
  assert.match(folder.title, /^Imported /);
  assert.deepEqual(await childTitles(folder.id), ['Imported page', 'Sub']);
  assert.match(lastToast(), /^Imported 2 bookmark\(s\) into “Imported /);
});

test('a JSON backup can be saved and restored, replacing every bookmark', async () => {
  const saved = captureDownloads();
  toolbarButton('Import and backup ▾').click();
  choose('Back up to JSON…');
  await idle();
  assert.equal(lastToast(), 'Backup downloaded.');
  const backup = JSON.parse(await saved[0].text());
  assert.equal(backup.format, 'bookmark-manager-backup');

  const [, jsonInput] = document.querySelectorAll('.tree-toolbar input[type=file]');
  const upload = (files) => {
    Object.defineProperty(jsonInput, 'files', { value: files, configurable: true });
    fire(jsonInput, 'change');
  };
  toolbarButton('Import and backup ▾').click();
  choose('Restore from JSON backup…');
  upload([]);
  upload([new File(['not json'], 'x.json')]);
  await idle();
  assert.equal(lastToast(), 'This is not a JSON file.');

  const other = { children: [{ id: 'toolbar_____', children: [{ title: 'Restored', url: 'https://restored.test/' }, { title: 'Search', url: 'place:sort=8' }] }] };
  upload([new File([JSON.stringify(other)], 'firefox.json')]);
  await idle();
  assert.equal(dialogText(), 'Replace all your bookmarks with the 1 in this backup? 1 saved search(es) will be left out, as Firefox does not let add-ons create them. You can undo this.');
  answer(false);
  await idle();
  assert.ok((await childTitles('toolbar_____')).includes('Alpha'));

  upload([new File([JSON.stringify(backup)], 'backup.json')]);
  await idle();
  assert.match(dialogText(), /^Replace all your bookmarks with the \d+ in this backup\? You can undo this\.$/);
  answer(true);
  await idle(80);
  assert.match(lastToast(), /^Restored \d+ bookmark\(s\) from the backup\.$/);
  assert.ok((await childTitles('menu________')).includes('Work'));
  assert.equal(dialog(), null);
});

test('another page can open this one with a search filled in', async () => {
  const { showInAll } = await import('../src/ui/views/all/state.js');
  location.hash = 'stats';
  await idle(50);
  showInAll({ go: (id) => { location.hash = id; } }, 'wiki');
  await idle(50);
  assert.equal(searchBox().value, 'wiki');
  assert.deepEqual(rowIds().length > 0, true);
  showInAll({ go: (id) => { location.hash = id; } }, '', 'recent');
  location.hash = 'stats';
  await idle(50);
  location.hash = 'all';
  await idle(50);
  assert.equal(searchBox().value, '');
  assert.ok(list().classList.contains('searching'));
  assert.ok(!rowIds().includes('menu________'));
});
