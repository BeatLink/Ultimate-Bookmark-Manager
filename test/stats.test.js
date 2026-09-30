import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteOf, protocolOf, addedByMonth, treeStats } from '../src/lib/stats.js';

test('sites group subdomains but keep country second levels and odd addresses apart', () => {
  assert.equal(siteOf('https://docs.python.org/3/'), 'python.org');
  assert.equal(siteOf('https://www.bbc.co.uk/news'), 'bbc.co.uk');
  assert.equal(siteOf('http://192.168.1.1/admin'), '192.168.1.1');
  assert.equal(siteOf('http://localhost:8080/'), 'localhost');
  assert.equal(siteOf('javascript:alert(1)'), '(javascript)');
  assert.equal(siteOf('place:sort=8'), '(place)');
  assert.equal(siteOf('not a url'), '(invalid address)');
  assert.equal(protocolOf('https://a.test'), 'https');
});

test('months run continuously from the first bookmark to now, capped', () => {
  const at = (y, m) => new Date(y, m - 1, 15).getTime();
  const now = at(2026, 9);
  const months = addedByMonth([{ dateAdded: at(2026, 6) }, { dateAdded: at(2026, 6) }, { dateAdded: at(2026, 8) }], now);
  assert.deepEqual(months, [{ month: '2026-06', count: 2 }, { month: '2026-07', count: 0 }, { month: '2026-08', count: 1 }, { month: '2026-09', count: 0 }]);
  const long = addedByMonth([{ dateAdded: at(2010, 1) }], now, 12);
  assert.equal(long.length, 12);
  assert.equal(long[0].month, '2025-10');
  assert.deepEqual(addedByMonth([], now), []);
});

test('tree stats count, rank and find extremes', () => {
  const flat = [
    { id: 'm', type: 'folder', title: 'Menu', path: [] },
    { id: 'd', type: 'folder', title: 'Dev', path: ['Menu'], parentId: 'm' },
    { id: 'e', type: 'folder', title: 'Empty', path: ['Menu'], parentId: 'm' },
    { id: 'b1', type: 'bookmark', url: 'https://docs.python.org/', title: 'Py', path: ['Menu', 'Dev'], parentId: 'd', dateAdded: 5 },
    { id: 'b2', type: 'bookmark', url: 'https://www.python.org/', title: 'Py2', path: ['Menu', 'Dev'], parentId: 'd', dateAdded: 1 },
    { id: 'b3', type: 'bookmark', url: 'http://rust-lang.org/', title: 'Rust', path: ['Menu'], parentId: 'm', dateAdded: 9 },
    { id: 's', type: 'separator', path: ['Menu'] },
  ];
  const s = treeStats(flat, new Date(1970, 0, 20).getTime());
  assert.equal(s.bookmarks, 3);
  assert.equal(s.folders, 3);
  assert.equal(s.separators, 1);
  assert.deepEqual(s.sites, [{ name: 'python.org', count: 2 }, { name: 'rust-lang.org', count: 1 }]);
  assert.deepEqual(s.protocols, [{ name: 'http', count: 1 }, { name: 'https', count: 2 }].sort((a, b) => b.count - a.count));
  assert.deepEqual(s.largestFolders, [{ name: 'Menu › Dev', count: 2 }, { name: 'Menu', count: 1 }], 'empty folders are left out');
  assert.equal(s.deepest, 2);
  assert.equal(s.oldest.id, 'b2');
  assert.equal(s.newest.id, 'b3');
});
