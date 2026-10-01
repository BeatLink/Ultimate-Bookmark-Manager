// Fixtures the tests share: a small bookmark tree, the root folders, and rules written in the old shape.

import { Actions } from '../src/lib/actions.js';
import { migrateRule } from '../src/lib/rules.js';
import { fakeBookmarks, fakeStorage } from './fake-browser.js';

export const spec = () => [
  { id: 'menu________', title: 'Menu', children: [
    { id: 'a', title: 'A', url: 'https://a.test' },
    { id: 'b', title: 'B', url: 'https://b.test' },
    { id: 'c', title: 'C', url: 'https://c.test' },
    { id: 'd', title: 'D', url: 'https://d.test' },
    { id: 'f', title: 'Folder', children: [{ id: 'e', title: 'E', url: 'https://e.test' }] },
    { id: 'g', title: 'Folder', children: [{ id: 'h', title: 'H', url: 'https://h.test' }] },
  ] },
  { id: 'unfiled_____', title: 'Other', children: [] },
];

// The tree as titles, URLs and types, for comparing before and after a change.
export const shape = async (bm) => {
  const strip = (n) => ({ title: n.title, url: n.url, type: n.type, children: n.children?.map(strip) });
  return strip((await bm.getTree())[0]);
};

export const titles = async (bm, id) => (await bm.getChildren(id)).map((n) => n.title);

export const setup = (tree = spec()) => {
  const bookmarks = fakeBookmarks(tree);
  const storage = fakeStorage();
  return { bookmarks, storage, actions: new Actions({ bookmarks, storage }) };
};

export const roots = [
  { id: 'menu________', title: 'Bookmarks Menu' },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar' },
  { id: 'unfiled_____', title: 'Other Bookmarks' },
];

export const bm = (id, title, url, path = ['Bookmarks Menu']) => ({ id, title, url, type: 'bookmark', path });

// Conditions and rules written in the old shape and converted, so every test also exercises the migration.
export const cond = (op, words, extra = {}) => ({ field: 'either', op, values: words ? words.split(',') : [], caseSensitive: false, wholeWords: false, ...extra });
export const group = (match, conditions) => ({ type: 'group', match, conditions });
export const rule = (id, conditions, target, extra = {}) => migrateRule({ id, name: id, enabled: true, match: 'any', conditions, target, ...extra });

// A rule whose query is written directly in the current shape.
export const queryRule = (id, query, target = 'X') => ({ ...rule(id, [], target), query });
