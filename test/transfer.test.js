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
