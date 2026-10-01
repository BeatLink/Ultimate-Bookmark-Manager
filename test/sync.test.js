import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitChunks, push, pull, reconcile, enableSync, disableSync, isSyncEnabled, hasConflictingRemote, guarded } from '../src/lib/sync.js';
import { fakeStorage } from './fake-browser.js';

const itemBytes = (k, v) => new TextEncoder().encode(k + JSON.stringify(v)).length;

test('chunks fit one sync item each and join back exactly', () => {
  const text = JSON.stringify({ s: 'é"\\\n'.repeat(5000) + '😀'.repeat(3000) });
  const chunks = splitChunks(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c, i) => itemBytes('cfg_' + i, c) <= 8192));
  assert.equal(chunks.join(''), text);
});

test('a change on one device reaches another, and applying it does not bounce back', async () => {
  const sync = fakeStorage();
  const a = fakeStorage();
  const b = fakeStorage();
  await a.set({ settings: { dupesFolderName: 'Copies' }, whitelist: { x: { title: 'X' } } });
  assert.equal(await reconcile(a, sync), 'pushed');
  assert.equal(await reconcile(b, sync), 'pulled', 'a device that never synced adopts the synced copy');
  assert.equal(b.data.settings.dupesFolderName, 'Copies');
  assert.deepEqual(b.data.whitelist, { x: { title: 'X' } });
  assert.equal(await push(b, sync), 'unchanged');

  await b.set({ settings: { dupesFolderName: 'Later' } });
  assert.equal(await push(b, sync), 'pushed');
  assert.equal(await pull(a, sync), 'pulled');
  assert.equal(a.data.settings.dupesFolderName, 'Later');
  assert.equal(await pull(a, sync), 'unchanged');
});

test('a half-arrived update is not applied', async () => {
  const sync = fakeStorage();
  const a = fakeStorage();
  await a.set({ settings: { big: 'x'.repeat(20000) } });
  await push(a, sync);
  delete sync.data.cfg_1;
  assert.equal(await pull(fakeStorage(), sync), 'incomplete');
});

test('shrinking removes leftover chunks', async () => {
  const sync = fakeStorage();
  const a = fakeStorage();
  await a.set({ settings: { big: 'x'.repeat(20000) } });
  await push(a, sync);
  await a.set({ settings: { big: 'x' } });
  await push(a, sync);
  assert.deepEqual(Object.keys(sync.data).sort(), ['cfg_0', 'cfg_meta']);
});

test('an ignore list too big to sync is left out, and settings still sync', async () => {
  const sync = fakeStorage();
  const a = fakeStorage();
  const whitelist = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`id${i}`, { title: 'x'.repeat(40), url: 'https://example.com/' + i }]));
  await a.set({ settings: { dupesFolderName: 'D' }, whitelist });
  await push(a, sync);
  assert.equal(sync.data.cfg_meta.partial, true);
  const b = fakeStorage();
  await b.set({ whitelist: { mine: {} } });
  await pull(b, sync);
  assert.equal(b.data.settings.dupesFolderName, 'D');
  assert.deepEqual(b.data.whitelist, { mine: {} }, 'the local ignore list is kept');
});

test('turning sync on picks a side when both have settings', async () => {
  const sync = fakeStorage();
  const a = fakeStorage();
  await a.set({ settings: { dupesFolderName: 'A' } });
  await push(a, sync);
  const b = fakeStorage();
  await b.set({ settings: { dupesFolderName: 'B' }, syncEnabled: false });
  assert.equal(await reconcile(b, sync), 'disabled');
  assert.ok(await hasConflictingRemote(b, sync));
  await enableSync(b, sync, { preferRemote: false });
  assert.equal(await pull(a, sync), 'pulled');
  assert.equal(a.data.settings.dupesFolderName, 'B');
});

test('failures are recorded for the settings page', async () => {
  const a = fakeStorage();
  const broken = { get: async () => ({}), set: async () => { throw new Error('Quota exceeded'); }, remove: async () => {} };
  await a.set({ settings: {} });
  assert.equal(await guarded(a, () => push(a, broken)), 'error');
  assert.equal(a.data.syncState.error, 'Quota exceeded');
});

test('turning sync off stops startup syncing and clears the last sync state', async () => {
  const local = fakeStorage();
  const sync = fakeStorage();
  await enableSync(local, sync, { preferRemote: false });
  assert.equal(await isSyncEnabled(local), true);
  await disableSync(local);
  assert.equal(await isSyncEnabled(local), false);
  assert.deepEqual(local.data.syncState, {});
  assert.equal(await reconcile(local, sync), 'disabled');
});
