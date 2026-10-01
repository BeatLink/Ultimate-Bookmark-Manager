import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, readSettings, readWhitelist, readRules, addNewCookieWords, DEFAULT_SETTINGS, RANGES } from '../src/lib/settings.js';
import { fakeStorage } from './fake-browser.js';

test('the defaults check links without cookies and skip private addresses', () => {
  assert.equal(DEFAULT_SETTINGS.linkCheck.useCookies, false);
  assert.equal(DEFAULT_SETTINGS.linkCheck.skipPrivate, true);
  assert.deepEqual(Object.keys(RANGES), ['concurrency', 'timeoutSeconds', 'historyLimit', 'historyDays']);
});

test('rules saved in the old shape are converted once and saved back', async () => {
  const storage = fakeStorage();
  await storage.set({ settings: { dupesFolderName: 'Copies', organize: { autoApply: true, rules: [{ id: 'r', match: 'all', conditions: [{ field: 'title', op: 'equals', values: ['a'] }] }] } } });
  const loaded = await loadSettings(storage);
  assert.equal(loaded.organize.rules[0].query.rules[0].operator, '=');
  assert.equal(storage.data.settings.organize.rules[0].query.combinator, 'and', 'the converted rules are stored');
  assert.equal(storage.data.settings.organize.autoApply, true, 'other settings are kept');
  assert.equal(storage.data.settings.dupesFolderName, 'Copies');
  const saved = JSON.stringify(storage.data.settings);
  await loadSettings(storage);
  assert.equal(JSON.stringify(storage.data.settings), saved, 'loading again changes nothing');
});

test('retired priority numbers and fallback flags are dropped from rules', () => {
  const query = { combinator: 'or', rules: [{ field: 'title', operator: 'contains', value: 'a' }] };
  const out = readRules([{ id: 'a', priority: 3, fallback: true, outranks: ['b'], query }, { id: 'b', query }]);
  assert.deepEqual(out, [{ id: 'a', outranks: ['b'], query }, { id: 'b', query }]);
});

test('duplicate rules saved under the old key are read and saved under the new one', async () => {
  const storage = fakeStorage();
  await storage.set({ settings: { rules: [{ kind: 'filter', pattern: 'x' }], organize: { rules: [] } } });
  const loaded = await loadSettings(storage);
  assert.deepEqual(loaded.duplicateRules, [{ kind: 'filter', pattern: 'x' }]);
  assert.ok(!('rules' in storage.data.settings));
  assert.deepEqual(storage.data.settings.duplicateRules, [{ kind: 'filter', pattern: 'x' }]);
});

test('damaged settings fall back to defaults instead of breaking the page', () => {
  const s = readSettings({
    matching: 'yes',
    dupesFolderName: 42,
    linkCheck: { concurrency: 1e9, timeoutSeconds: NaN, skipDomains: 'example.com', noCookieWords: ['logout', 7, null], useCookies: 'true' },
    historyDays: -5,
    duplicateRules: [null, { kind: 'filter', pattern: 'x' }],
    organize: { rules: [null, 'rule', { id: 'r', query: { rules: 'broken' } }, { id: 'ok', query: { combinator: 'or', rules: [{ field: 'title', operator: 'contains', value: 'a' }] }, target: 'X' }], autoApply: 1 },
    future: { kept: true },
  });
  assert.deepEqual(s.matching, DEFAULT_SETTINGS.matching);
  assert.equal(s.dupesFolderName, 'Dupes');
  assert.equal(s.linkCheck.concurrency, 32, 'numbers are clamped to what Settings allows');
  assert.equal(s.linkCheck.timeoutSeconds, 15);
  assert.deepEqual(s.linkCheck.skipDomains, []);
  assert.deepEqual(s.linkCheck.noCookieWords, ['logout']);
  assert.equal(s.linkCheck.useCookies, false);
  assert.equal(s.historyDays, 1);
  assert.deepEqual(s.duplicateRules, [{ kind: 'filter', pattern: 'x' }]);
  assert.deepEqual(s.organize.rules.map((r) => r.id), ['ok']);
  assert.equal(s.organize.autoApply, false);
  assert.deepEqual(s.future, { kept: true }, 'settings from a newer version are kept');
  assert.deepEqual(readSettings('nonsense'), readSettings(undefined));
});

test('the whitelist keeps only entries that are objects, with text titles and URLs', () => {
  assert.deepEqual(readWhitelist({ a: { title: 'A', url: 'u' }, b: null, c: 'x', d: { title: 5 } }), { a: { title: 'A', url: 'u' }, d: { title: '5', url: '' } });
  assert.deepEqual(readWhitelist([1, 2]), {});
});

test('saved never-send-cookies lists gain the newer words once, keeping the cookie choice', async () => {
  const storage = fakeStorage();
  await storage.set({ settings: { linkCheck: { useCookies: true, noCookieWords: ['logout', 'mine'] } } });
  assert.equal(await addNewCookieWords(storage), true);
  const words = storage.data.settings.linkCheck.noCookieWords;
  assert.deepEqual(words.slice(0, 2), ['logout', 'mine']);
  assert.ok(words.includes('delete') && words.includes('token'));
  assert.equal(storage.data.settings.linkCheck.useCookies, true);
  storage.data.settings.linkCheck.noCookieWords = ['logout'];
  assert.equal(await addNewCookieWords(storage), false, 'a word removed afterwards stays removed');
  assert.deepEqual(storage.data.settings.linkCheck.noCookieWords, ['logout']);
});

test('a device that never saved settings already gets the default words', async () => {
  const storage = fakeStorage();
  assert.equal(await addNewCookieWords(storage), false);
  assert.equal(storage.data.settings, undefined);
});
