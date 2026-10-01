import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Actions } from '../src/lib/actions.js';
import { sortedByName, pathTo, flatten } from '../src/lib/tree.js';
import { parseBackup } from '../src/lib/backup.js';
import { toBookmarkHtml, parseBookmarkHtml, countBookmarks } from '../src/lib/bookmark-html.js';
import { fakeBookmarks, fakeStorage } from './fake-browser.js';

const spec = () => [
  { id: 'menu________', title: 'Menu', children: [
    { id: 'a', title: 'A', url: 'https://a.test' },
    { id: 'b', title: 'B', url: 'https://b.test' },
    { id: 'c', title: 'C', url: 'https://c.test' },
    { id: 'd', title: 'D', url: 'https://d.test' },
    { id: 'f', title: 'Folder', children: [{ id: 'e', title: 'E', url: 'https://e.test' }] },
  ] },
  { id: 'unfiled_____', title: 'Other', children: [] },
];

const titles = async (bm, id) => (await bm.getChildren(id)).map((n) => n.title);
const shape = async (bm) => {
  const strip = (n) => ({ title: n.title, url: n.url, type: n.type, children: n.children?.map(strip) });
  return strip((await bm.getTree())[0]);
};
const setup = () => {
  const bookmarks = fakeBookmarks(spec());
  return { bookmarks, actions: new Actions({ bookmarks, storage: fakeStorage() }) };
};

test('moving items down in their own folder lands them before the drop target', async () => {
  const { bookmarks, actions } = setup();
  await actions.moveItems([{ id: 'a' }, { id: 'b' }], 'menu________', 3);
  assert.deepEqual(await titles(bookmarks, 'menu________'), ['C', 'A', 'B', 'D', 'Folder']);
});

test('moving items up in their own folder keeps their order', async () => {
  const { bookmarks, actions } = setup();
  await actions.moveItems([{ id: 'c' }, { id: 'd' }], 'menu________', 0);
  assert.deepEqual(await titles(bookmarks, 'menu________'), ['C', 'D', 'A', 'B', 'Folder']);
});

test('moving into another folder then undoing restores every position', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  await actions.moveItems([{ id: 'd' }, { id: 'a' }], 'f', 0);
  assert.deepEqual(await titles(bookmarks, 'f'), ['D', 'A', 'E']);
  await actions.moveItems([{ id: 'b' }], 'f', null);
  assert.deepEqual(await titles(bookmarks, 'f'), ['D', 'A', 'E', 'B']);
  await actions.undoLatest();
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('creating copies of a folder builds its contents and undo removes it in one step', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  const [copy] = await actions.create('unfiled_____', null, [
    { type: 'folder', title: 'Copy', children: [{ type: 'bookmark', title: 'X', url: 'https://x.test' }, { type: 'separator', title: '' }] },
  ]);
  assert.deepEqual(await titles(bookmarks, copy), ['X', '']);
  assert.equal((await actions.list())[0].ops.length, 1);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('sorting a folder puts folders first, keeps separators in place, and undoes', async () => {
  const bookmarks = fakeBookmarks([{ id: 'menu________', title: 'Menu', children: [
    { title: 'b', url: 'https://b.test' }, { title: 'Z', children: [] }, { title: 'a', url: 'https://a.test' },
    { type: 'separator' },
    { title: 'item10', url: 'https://10.test' }, { title: 'item2', url: 'https://2.test' },
  ] }]);
  const actions = new Actions({ bookmarks, storage: fakeStorage() });
  const before = await shape(bookmarks);
  await actions.sortFolder('menu________');
  assert.deepEqual(await titles(bookmarks, 'menu________'), ['Z', 'a', 'b', '', 'item2', 'item10']);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('sortedByName leaves an already sorted folder alone', () => {
  const kids = [{ id: '1', title: 'F', children: [] }, { id: '2', title: 'a', url: 'x' }];
  assert.deepEqual(sortedByName(kids).map((k) => k.id), ['1', '2']);
});

test('pathTo lists folder titles from the top-level folder down', async () => {
  const { bookmarks } = setup();
  const [root] = await bookmarks.getTree();
  const byId = new Map();
  const walk = (n) => { byId.set(n.id, n); n.children?.forEach(walk); };
  walk(root);
  assert.deepEqual(pathTo(byId, 'e'), ['Menu', 'Folder', 'E']);
});

test('HTML export and import round-trip folders, bookmarks, separators and escaped text', async () => {
  const bookmarks = fakeBookmarks([{ id: 'menu________', title: 'Menu', children: [
    { title: 'Tom & “Jerry” <3', url: 'https://a.test/?x=1&y=2' },
    { type: 'separator' },
    { title: 'Sub', children: [{ title: 'Inner', url: 'https://b.test' }, { title: 'Empty', children: [] }] },
  ] }]);
  const [root] = await bookmarks.getTree();
  const html = toBookmarkHtml(root.children);
  const parsed = parseBookmarkHtml(html);
  assert.equal(parsed.length, 1);
  const [menu] = parsed;
  assert.equal(menu.title, 'Menu');
  assert.deepEqual(menu.children.map((c) => [c.type, c.title, c.url]), [
    ['bookmark', 'Tom & “Jerry” <3', 'https://a.test/?x=1&y=2'],
    ['separator', '', undefined],
    ['folder', 'Sub', undefined],
  ]);
  assert.deepEqual(menu.children[2].children.map((c) => c.title), ['Inner', 'Empty']);
  assert.equal(countBookmarks(parsed), 2);
  assert.equal(flatten(root).filter((n) => n.type === 'bookmark').length, 2);
});

test('import reads the loose markup other browsers write', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
<DT><H3 ADD_DATE="1">Bar</H3>
<DL><p>
<DT><a href='https://one.test' add_date=2>One &#38; only</a>
<DT><A HREF=https://two.test>Two</A>
</DL><p>
<DT><A HREF="https://three.test">Three</A>
</DL>`;
  const parsed = parseBookmarkHtml(html);
  assert.deepEqual(parsed.map((c) => c.title), ['Bar', 'Three']);
  assert.deepEqual(parsed[0].children.map((c) => [c.title, c.url]), [['One & only', 'https://one.test'], ['Two', 'https://two.test']]);
});

test('undo then redo applies a change again, and redo again after a second undo', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  await actions.moveItems([{ id: 'a' }], 'f', null);
  await actions.remove(['f']);
  const after = await shape(bookmarks);
  await actions.undoLatest();
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
  assert.equal(await actions.nextRedo(), 'Moved 1 item(s)');
  await actions.redoLatest();
  await actions.redoLatest();
  assert.deepEqual(await shape(bookmarks), after);
  assert.equal(await actions.nextRedo(), null);
  await actions.undoLatest();
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
  await actions.redoLatest();
  await actions.redoLatest();
  assert.deepEqual(await shape(bookmarks), after);
});

test('a new change clears what could be redone', async () => {
  const { actions } = setup();
  await actions.update([{ id: 'a', title: 'X' }]);
  await actions.undoLatest();
  assert.ok(await actions.nextRedo());
  await actions.update([{ id: 'b', title: 'Y' }]);
  assert.equal(await actions.nextRedo(), null);
  assert.equal(await actions.redoLatest(), null);
});

test('restoring a backup replaces the top-level folders and undoes in one step', async () => {
  const { bookmarks, actions } = setup();
  const before = await shape(bookmarks);
  const { folders, bookmarks: count, skipped } = parseBackup(JSON.stringify({
    guid: 'root________', children: [
      { guid: 'menu________', root: 'bookmarksMenuFolder', children: [
        { typeCode: 1, title: 'New', uri: 'https://new.test' },
        { typeCode: 1, title: 'Most visited', uri: 'place:sort=8' },
        { typeCode: 2, title: 'Dir', children: [{ typeCode: 3 }] },
      ] },
    ],
  }));
  assert.equal(count, 1);
  assert.equal(skipped, 1);
  await actions.restore(folders);
  assert.deepEqual(await titles(bookmarks, 'menu________'), ['New', 'Dir']);
  assert.deepEqual(await titles(bookmarks, 'unfiled_____'), []);
  await actions.undoLatest();
  assert.deepEqual(await shape(bookmarks), before);
});

test('our own backup format restores too, and other files are refused', async () => {
  const { bookmarks } = setup();
  const [root] = await bookmarks.getTree();
  const parsed = parseBackup(JSON.stringify({ format: 'bookmark-manager-backup', version: 1, tree: root }));
  assert.deepEqual(Object.keys(parsed.folders), ['menu________', 'unfiled_____']);
  assert.equal(parsed.bookmarks, 5);
  assert.throws(() => parseBackup('nope'), /not a JSON/);
  assert.throws(() => parseBackup('{"a":1}'), /not a bookmarks backup/);
});
