import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExport, parseImport, applyImport } from '../src/lib/transfer.js';
import { fakeStorage } from './fake-browser.js';

test('an export imports back, replacing settings and adding ignored items', async () => {
  const from = fakeStorage();
  await from.set({ settings: { dupesFolderName: 'Copies', organize: { rules: [{ id: 'r' }] } }, whitelist: { a: { title: 'A' } }, history: { entries: [1] } });
  const file = JSON.stringify(await buildExport(from));
  assert.ok(!('history' in JSON.parse(file)), 'undo history is not exported');

  const to = fakeStorage();
  await to.set({ settings: { dupesFolderName: 'Old' }, whitelist: { b: { title: 'B' } } });
  const parsed = parseImport(file);
  assert.equal(parsed.rules, 1);
  await applyImport(parsed, to);
  assert.equal(to.data.settings.dupesFolderName, 'Copies');
  assert.equal(to.data.settings.linkCheck.concurrency, 6, 'missing settings get defaults');
  assert.deepEqual(Object.keys(to.data.whitelist).sort(), ['a', 'b']);
});

test('other files are rejected with a readable reason', () => {
  assert.throws(() => parseImport('nope'), /not valid JSON/);
  assert.throws(() => parseImport('{"format":"something-else"}'), /not an Ultimate Bookmark Manager settings file/);
  assert.throws(() => parseImport('{"format":"bookmark-manager-settings","version":9,"settings":{}}'), /newer version/);
});

test('rules in an older file are converted on import', () => {
  const file = JSON.stringify({ format: 'bookmark-manager-settings', version: 1, settings: { organize: { rules: [{ id: 'r', match: 'none', conditions: [{ field: 'title', op: 'contains', values: ['a'] }] }] } } });
  const { settings } = parseImport(file);
  assert.equal(settings.organize.rules[0].query.not, true);
  assert.equal(settings.organize.rules[0].query.rules[0].operator, 'contains');
});

test('rules saved in the old shape are converted once and saved back', async () => {
  const { loadSettings } = await import('../src/lib/settings.js');
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

test('damaged settings fall back to defaults instead of breaking the page', async () => {
  const { readSettings, readWhitelist, DEFAULT_SETTINGS } = await import('../src/lib/settings.js');
  const s = readSettings({
    matching: 'yes',
    dupesFolderName: 42,
    linkCheck: { concurrency: 1e9, timeoutSeconds: NaN, skipDomains: 'example.com', noCookieWords: ['logout', 7, null], useCookies: 'true' },
    historyDays: -5,
    rules: [null, { kind: 'filter', pattern: 'x' }],
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
  assert.deepEqual(s.rules, [{ kind: 'filter', pattern: 'x' }]);
  assert.deepEqual(s.organize.rules.map((r) => r.id), ['ok']);
  assert.equal(s.organize.autoApply, false);
  assert.deepEqual(s.future, { kept: true }, 'settings from a newer version are kept');
  assert.deepEqual(readSettings('nonsense'), readSettings(undefined));
  assert.deepEqual(readWhitelist({ a: { title: 'A', url: 'u' }, b: null, c: 'x', d: { title: 5 } }), { a: { title: 'A', url: 'u' }, d: { title: '5', url: '' } });
  assert.deepEqual(readWhitelist([1, 2]), {});
});

test('an imported file with damaged parts imports what it can', async () => {
  const { parseImport } = await import('../src/lib/transfer.js');
  const parsed = parseImport(JSON.stringify({ format: 'bookmark-manager-settings', version: 1, settings: { linkCheck: null, organize: { rules: [{}] } }, whitelist: { a: 'bad' } }));
  assert.equal(parsed.rules, 0);
  assert.deepEqual(parsed.whitelist, {});
  assert.ok(Array.isArray(parsed.settings.linkCheck.skipDomains));
});

test('saved never-send-cookies lists gain the newer words once, keeping the cookie choice', async () => {
  const { addNewCookieWords } = await import('../src/lib/settings.js');
  const stored = { settings: { linkCheck: { useCookies: true, noCookieWords: ['logout', 'mine'] } } };
  const storage = { async get(keys) { return Object.fromEntries([keys].flat().map((k) => [k, stored[k]])); }, async set(v) { Object.assign(stored, v); } };
  assert.equal(await addNewCookieWords(storage), true);
  const words = stored.settings.linkCheck.noCookieWords;
  assert.deepEqual(words.slice(0, 2), ['logout', 'mine']);
  assert.ok(words.includes('delete') && words.includes('token'));
  assert.equal(stored.settings.linkCheck.useCookies, true);
  stored.settings.linkCheck.noCookieWords = ['logout'];
  assert.equal(await addNewCookieWords(storage), false, 'a word removed afterwards stays removed');
  assert.deepEqual(stored.settings.linkCheck.noCookieWords, ['logout']);
  const fresh = {};
  const empty = { async get(keys) { return Object.fromEntries([keys].flat().map((k) => [k, fresh[k]])); }, async set(v) { Object.assign(fresh, v); } };
  assert.equal(await addNewCookieWords(empty), false, 'a device that never saved settings already gets the defaults');
  assert.equal(fresh.settings, undefined);
});
