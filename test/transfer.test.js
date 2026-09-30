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
  assert.throws(() => parseImport('{"format":"something-else"}'), /not a Bookmark Manager settings file/);
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
