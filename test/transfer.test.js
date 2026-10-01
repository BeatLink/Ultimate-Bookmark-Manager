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

test('an imported file with damaged parts imports what it can', () => {
  const parsed = parseImport(JSON.stringify({ format: 'bookmark-manager-settings', version: 1, settings: { linkCheck: null, organize: { rules: [{}] } }, whitelist: { a: 'bad' } }));
  assert.equal(parsed.rules, 0);
  assert.deepEqual(parsed.whitelist, {});
  assert.ok(Array.isArray(parsed.settings.linkCheck.skipDomains));
});
