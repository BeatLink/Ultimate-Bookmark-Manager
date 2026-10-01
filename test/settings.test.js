import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, merge, readRules, readSettings, loadSettings, saveSettings, readWhitelist, addNewCookieWords,
  loadWhitelist, addToWhitelist, removeFromWhitelist, loadLinkResults, saveLinkResults,
} from '../src/lib/settings.js';
import { DEFAULT_NO_COOKIE_WORDS } from '../src/lib/linkcheck.js';
import { fakeStorage } from './fake-browser.js';

const query = (value) => ({ id: 'q', combinator: 'or', not: false, rules: [{ id: 'c', field: 'either', operator: 'contains', value }] });
const goodRule = (id) => ({ id, name: id, target: 'Dev', query: query('rust') });

test('settings missing from storage come back as the defaults', () => {
  assert.deepEqual(readSettings(undefined), DEFAULT_SETTINGS);
  assert.notEqual(readSettings(undefined).linkCheck.noCookieWords, DEFAULT_SETTINGS.linkCheck.noCookieWords);
});

test('values of the wrong type fall back to their default and numbers are kept within range', () => {
  const s = readSettings({
    dupesFolderName: 7,
    historyLimit: 10000,
    historyDays: 0,
    linkCheck: { concurrency: Infinity, timeoutSeconds: 1, skipDomains: ['a.test', 3, null], useCookies: 'yes' },
    organize: 'broken',
  });
  assert.equal(s.dupesFolderName, 'Dupes');
  assert.equal(s.historyLimit, 500);
  assert.equal(s.historyDays, 1);
  assert.equal(s.linkCheck.concurrency, 6);
  assert.equal(s.linkCheck.timeoutSeconds, 3);
  assert.deepEqual(s.linkCheck.skipDomains, ['a.test']);
  assert.equal(s.linkCheck.useCookies, false);
  assert.deepEqual(s.organize, { rules: [], autoApply: false });
});

test('settings this version does not know are kept, except a prototype key', () => {
  const stored = JSON.parse('{"future":{"x":1},"__proto__":{"polluted":true}}');
  const s = merge(DEFAULT_SETTINGS, stored);
  assert.deepEqual(s.future, { x: 1 });
  assert.ok(!Object.hasOwn(s, '__proto__'));
  assert.equal(s.polluted, undefined);
});

test('lists of objects keep only objects', () => {
  assert.deepEqual(merge([], [{ a: 1 }, 'text', [1], null], 'rules'), [{ a: 1 }]);
});

test('organize rules the converter cannot read are left out and retired ranking fields dropped', () => {
  const rules = readRules([
    { ...goodRule('keep'), priority: 3, fallback: true },
    { id: 'bad-conditions', conditions: 5 },
    { id: 'bad-item', conditions: [null] },
    { id: 'no-query', target: 'X', query: { rules: 'nope' } },
  ]);
  assert.deepEqual(rules.map((r) => r.id), ['keep']);
  assert.ok(!('priority' in rules[0]) && !('fallback' in rules[0]));
});

test('loading settings saves converted rules straight back so they are converted once', async () => {
  const storage = fakeStorage();
  await storage.set({ settings: { historyLimit: 9, organize: { autoApply: true, rules: [{ id: 'old', name: 'old', enabled: true, match: 'any', conditions: [{ field: 'either', op: 'contains', values: ['rust'] }], target: 'Dev' }] } } });
  const loaded = await loadSettings(storage);
  assert.ok(loaded.organize.rules[0].query);
  assert.deepEqual(storage.data.settings.organize.rules, loaded.organize.rules);
  assert.equal(storage.data.settings.historyLimit, 9);
  assert.equal(storage.data.settings.organize.autoApply, true);
});

test('loading settings with rules already in shape writes nothing', async () => {
  const storage = fakeStorage();
  await storage.set({ settings: { organize: { rules: [goodRule('a')] } } });
  let writes = 0;
  const set = storage.set;
  storage.set = async (obj) => { writes++; return set(obj); };
  const loaded = await loadSettings(storage);
  assert.equal(writes, 0);
  assert.equal(loaded.organize.rules[0].id, 'a');
});

test('loading settings drops a damaged rule from storage too', async () => {
  const storage = fakeStorage();
  await storage.set({ settings: { organize: { rules: [goodRule('a'), { id: 'b', conditions: 5 }] } } });
  await loadSettings(storage);
  assert.deepEqual(storage.data.settings.organize.rules.map((r) => r.id), ['a']);
});

test('settings are read from and saved to the extension storage when none is given', async () => {
  const local = fakeStorage();
  globalThis.browser = { storage: { local } };
  try {
    await saveSettings({ historyDays: 4 });
    assert.equal((await loadSettings()).historyDays, 4);
    await saveLinkResults({ a: 1 });
    assert.deepEqual(await loadLinkResults(), { a: 1 });
  } finally {
    delete globalThis.browser;
  }
});

test('the ignore list keeps only well-formed entries, as text, with the inside flag only when true', () => {
  const whitelist = JSON.parse('{"a":{"title":"A","url":5},"b":"nope","c":{"inside":true},"d":{"inside":"yes"},"__proto__":{"title":"x"}}');
  assert.deepEqual(readWhitelist(whitelist), {
    a: { title: 'A', url: '5' },
    c: { title: '', url: '', inside: true },
    d: { title: '', url: '' },
  });
  assert.deepEqual(readWhitelist(['a']), {});
  assert.deepEqual(readWhitelist(null), {});
});

test('items are added to and removed from the ignore list', async () => {
  const storage = fakeStorage();
  assert.deepEqual(await loadWhitelist(storage), {});
  await addToWhitelist([{ id: 'a', title: 'Alpha', url: 'https://a.test/' }, { id: 'f', inside: true }], storage);
  assert.deepEqual(await loadWhitelist(storage), {
    a: { title: 'Alpha', url: 'https://a.test/' },
    f: { title: '', url: '', inside: true },
  });
  const after = await removeFromWhitelist(['a', 'missing'], storage);
  assert.deepEqual(after, { f: { title: '', url: '', inside: true } });
  assert.deepEqual(storage.data.whitelist, after);
});

test('saved link-check results are null until some are saved', async () => {
  const storage = fakeStorage();
  assert.equal(await loadLinkResults(storage), null);
  await saveLinkResults({ when: 1, results: [] }, storage);
  assert.deepEqual(await loadLinkResults(storage), { when: 1, results: [] });
});

test('newer never-send-cookies words are added to a saved list only once', async () => {
  const storage = fakeStorage();
  await storage.set({ settings: { historyLimit: 3, linkCheck: { noCookieWords: ['mine', DEFAULT_NO_COOKIE_WORDS[0]] } } });
  assert.equal(await addNewCookieWords(storage), true);
  const words = storage.data.settings.linkCheck.noCookieWords;
  assert.deepEqual(words.slice(0, 2), ['mine', DEFAULT_NO_COOKIE_WORDS[0]]);
  assert.deepEqual(new Set(words), new Set(['mine', ...DEFAULT_NO_COOKIE_WORDS]));
  assert.equal(storage.data.settings.historyLimit, 3);
  storage.data.settings.linkCheck.noCookieWords = ['mine'];
  assert.equal(await addNewCookieWords(storage), false);
  assert.deepEqual(storage.data.settings.linkCheck.noCookieWords, ['mine']);
});

test('adding cookie words only marks it done when no list is saved or nothing is missing', async () => {
  const empty = fakeStorage();
  assert.equal(await addNewCookieWords(empty), false);
  assert.deepEqual(empty.data, { cookieWordsAdded: true });
  const full = fakeStorage();
  await full.set({ settings: { linkCheck: { noCookieWords: [...DEFAULT_NO_COOKIE_WORDS] } } });
  assert.equal(await addNewCookieWords(full), false);
  assert.deepEqual(full.data.settings.linkCheck.noCookieWords, DEFAULT_NO_COOKIE_WORDS);
});
