import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatten } from '../src/lib/tree.js';
import { readSettings } from '../src/lib/settings.js';
import * as scans from '../src/ui/scans.js';

const tree = () => ({ id: 'root________', children: [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'a', title: 'Alpha', url: 'https://alpha.test/' },
    { id: 'a2', title: 'Alpha again', url: 'https://alpha.test/' },
    { id: 'u', title: '', url: 'https://nameless.test/' },
    { id: 'hid', title: '', url: 'https://hidden.test/' },
    { id: 'e', title: 'Empty', children: [] },
    { id: 'w1', title: 'Work', children: [{ id: 'w1b', title: 'W', url: 'https://w.test/' }] },
    { id: 'w2', title: 'Work', children: [] },
  ] },
] });

// A context like the dashboard's, counting how often each scan really runs.
function makeCtx({ whitelist = [], linkResults = null } = {}) {
  const root = tree();
  const cache = new Map();
  const runs = {};
  return {
    runs,
    state: { root, flat: flatten(root), settings: readSettings({}), linkResults },
    ignoredIds: () => new Set(whitelist),
    memo(key, fn) {
      if (!cache.has(key)) {
        runs[key] = (runs[key] ?? 0) + 1;
        cache.set(key, fn());
      }
      return cache.get(key);
    },
  };
}

test('the duplicate scan groups bookmarks with the same address and runs once per load', () => {
  const ctx = makeCtx();
  const { groups } = scans.duplicates(ctx);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map((b) => b.id), ['a', 'a2']);
  assert.equal(scans.duplicates(ctx), scans.duplicates(ctx));
  assert.equal(ctx.runs.duplicates, 1);
});

test('the folder and name scans find empty folders, repeated folder names and unnamed bookmarks, minus ignored ones', () => {
  const ctx = makeCtx({ whitelist: ['hid'] });
  assert.deepEqual(scans.emptyFolders(ctx).map((f) => f.id).sort(), ['e', 'w2']);
  assert.deepEqual(scans.sameNameFolders(ctx).flatMap((g) => g.folders.map((f) => f.id)), ['w1', 'w2']);
  assert.deepEqual(scans.untitled(ctx).map((b) => b.id), ['u']);
  assert.deepEqual(Object.keys(ctx.runs).sort(), ['empty', 'same-name', 'untitled']);
});

test('saved link results are none until a check has run', () => {
  assert.equal(scans.linkResults(makeCtx()), null);
});

test('saved link results drop bookmarks that were removed, edited or ignored, and take current names and folders', () => {
  const ctx = makeCtx({
    whitelist: ['hid'],
    linkResults: {
      time: 5,
      results: [
        { id: 'a', url: 'https://alpha.test/', title: 'Stale name', status: 'broken' },
        { id: 'a2', url: 'https://changed.test/', status: 'broken' },
        { id: 'gone', url: 'https://gone.test/', status: 'broken' },
        { id: 'hid', url: 'https://hidden.test/', status: 'redirect' },
      ],
    },
  });
  const out = scans.linkResults(ctx);
  assert.equal(out.time, 5);
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].id, 'a');
  assert.equal(out.results[0].title, 'Alpha');
  assert.equal(out.results[0].status, 'broken');
  assert.deepEqual(out.results[0].path, ['Bookmarks Menu']);
});
