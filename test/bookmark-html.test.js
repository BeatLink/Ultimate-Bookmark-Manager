import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBookmarkHtml, parseBookmarkHtml } from '../src/lib/bookmark-html.js';
import { countBookmarks } from '../src/lib/tree.js';
import { setup } from './helpers.js';

test('HTML export and import round-trip folders, bookmarks, separators and escaped text', async () => {
  const { bookmarks } = setup([{ id: 'menu________', title: 'Menu', children: [
    { title: 'Tom & “Jerry” <3', url: 'https://a.test/?x=1&y=2' },
    { type: 'separator' },
    { title: 'Sub', children: [{ title: 'Inner', url: 'https://b.test' }, { title: 'Empty', children: [] }] },
  ] }]);
  const [root] = await bookmarks.getTree();
  const parsed = parseBookmarkHtml(toBookmarkHtml(root.children));
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

test('a list without a folder heading, nested or after the first, becomes an untitled folder', () => {
  const nested = '<DL><p><DT><A HREF="https://a.test/">A</A><DL><p><DT><A HREF="https://b.test/">B</A></DL></DL>';
  const after = '<DL><p><DT><A HREF="https://a.test/">A</A></DL><DL><DT><A HREF="https://b.test/">B</A></DL>';
  const expected = [
    { type: 'bookmark', title: 'A', url: 'https://a.test/' },
    { type: 'folder', title: '', children: [{ type: 'bookmark', title: 'B', url: 'https://b.test/' }] },
  ];
  assert.deepEqual(parseBookmarkHtml(nested), expected);
  assert.deepEqual(parseBookmarkHtml(after), expected);
});
