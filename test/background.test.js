import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser } from './browser-env.js';
import { fingerprint } from '../src/lib/sync.js';

// One set of fake timers for the whole file, since clearing a timer left from another set cancels the wrong one.
mock.timers.enable({ apis: ['setTimeout'] });
const browser = fakeBrowser();
globalThis.browser = browser;
const { sendMessage } = browser.runtime;
await import('../src/background.js');
const loadCalls = [...browser.calls];

const local = browser.storage.local;
const sync = browser.storage.sync;

// Lets every pending promise run; storage and bookmarks here never wait on a real timer.
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};
const callsOf = (name) => browser.calls.filter(([n]) => n === name).map(([, ...args]) => args);
const openedUrls = () => callsOf('tabs.create').map(([props]) => props.url);
const dashboard = (view) => `moz-extension://test/src/ui/app.html#${view}`;
const parentOf = async (id) => (await browser.bookmarks.get(id))[0].parentId;
const childTitles = async (id) => (await browser.bookmarks.getChildren(id)).map((n) => n.title);

const rule = (id, word, target) => ({
  id, name: id, enabled: true, target, outranks: [], createdAt: 1,
  query: { id: `${id}-q`, combinator: 'or', not: false, rules: [{ id: `${id}-c`, field: 'either', operator: 'contains', value: word, caseSensitive: false, wholeWords: false }] },
});
const autoSettings = (extra = {}) => ({ organize: { autoApply: true, rules: [rule('dev', 'rust', 'Other Bookmarks/Dev')] }, ...extra });

beforeEach(async () => {
  mock.timers.tick(10000);
  await flush();
  for (const area of [local, sync]) for (const k of Object.keys(area.data)) delete area.data[k];
  browser.calls.length = 0;
  browser.runtime.sendMessage = sendMessage;
});

test('loading the script sets the address-bar suggestion and opens nothing', () => {
  const [[name, { description }]] = loadCalls;
  assert.equal(name, 'omnibox.setDefaultSuggestion');
  assert.match(description, /type a view: duplicates, broken/);
  assert.equal(loadCalls.length, 1);
});

test('the toolbar button opens the dashboard on its first view when no dashboard tab answers', async () => {
  browser.action.onClicked.emit();
  await flush();
  assert.deepEqual(callsOf('runtime.sendMessage'), [[{ type: 'focus-dashboard', view: 'stats' }]]);
  assert.deepEqual(openedUrls(), [dashboard('stats')]);
});

test('the toolbar button opens no new tab when an open dashboard takes the focus', async () => {
  browser.runtime.sendMessage = async () => true;
  browser.action.onClicked.emit();
  await flush();
  assert.deepEqual(openedUrls(), []);
});

test('a failed message to the dashboard, as when none is open to receive it, still opens a tab', async () => {
  browser.runtime.sendMessage = async () => { throw new Error('Could not establish connection'); };
  browser.action.onClicked.emit();
  await flush();
  assert.deepEqual(openedUrls(), [dashboard('stats')]);
});

test('the keyboard shortcut opens the dashboard and other commands are ignored', async () => {
  browser.commands.onCommand.emit('something-else');
  await flush();
  assert.deepEqual(openedUrls(), []);
  browser.commands.onCommand.emit('open-dashboard');
  await flush();
  assert.deepEqual(openedUrls(), [dashboard('stats')]);
});

test('installing builds a Tools menu with one item for every view', async () => {
  browser.runtime.onInstalled.emit({ reason: 'install' });
  await flush();
  assert.deepEqual(callsOf('menus.removeAll'), [[]]);
  const items = callsOf('menus.create').map(([item]) => item);
  assert.deepEqual(items[0], { id: 'root', title: 'Ultimate Bookmark Manager', contexts: ['tools_menu'] });
  assert.equal(items.length, 13);
  assert.ok(items.slice(1).every((item) => item.parentId === 'root' && item.id.startsWith('view:')));
  assert.deepEqual(items.find((item) => item.id === 'view:broken'), { id: 'view:broken', parentId: 'root', title: 'Broken links', contexts: ['tools_menu'] });
});

test('installing clears what the removed AI organizer left behind and keeps the other settings', async () => {
  await local.set({ aiSummaries: { x: 1 }, aiResume: true, settings: { ai: { model: 'm' }, historyLimit: 9 } });
  browser.runtime.onInstalled.emit({ reason: 'update' });
  await flush();
  assert.ok(!('aiSummaries' in local.data));
  assert.ok(!('aiResume' in local.data));
  assert.equal(local.data.settings.ai, undefined);
  assert.equal(local.data.settings.historyLimit, 9);
});

test('installing leaves settings without AI leftovers unwritten', async () => {
  Object.assign(local.data, { cookieWordsAdded: true, settings: { historyLimit: 9 } });
  const writes = [];
  const watch = (changes) => writes.push(...Object.keys(changes));
  browser.storage.onChanged.addListener(watch);
  browser.runtime.onInstalled.emit({ reason: 'update' });
  await flush();
  browser.storage.onChanged.removeListener(watch);
  assert.ok(!writes.includes('settings'));
  assert.deepEqual(local.data.settings, { historyLimit: 9 });
});

test('installing adds the newer never-send-cookies words to a saved list once', async () => {
  await local.set({ settings: { linkCheck: { noCookieWords: ['mine'] } } });
  browser.runtime.onInstalled.emit({ reason: 'update' });
  await flush();
  const words = local.data.settings.linkCheck.noCookieWords;
  assert.equal(words[0], 'mine');
  assert.ok(words.length > 1);
  assert.equal(local.data.cookieWordsAdded, true);
});

test('a cleanup that fails on install is logged instead of thrown', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const { remove, get } = local;
  local.remove = async () => { throw new Error('disk full'); };
  local.get = async () => { throw new Error('disk full'); };
  try {
    browser.runtime.onInstalled.emit({ reason: 'update' });
    await flush();
  } finally {
    local.remove = remove;
    local.get = get;
  }
  const messages = error.mock.calls.map((c) => c.arguments[0]);
  assert.ok(messages.includes('Cleanup failed'));
  assert.ok(messages.includes('Updating the never-send-cookies words failed'));
});

test('installing uploads this device settings to sync a second later', async () => {
  local.data.settings = { historyLimit: 12 };
  browser.runtime.onInstalled.emit({ reason: 'install' });
  await flush();
  assert.equal(sync.data.cfg_meta, undefined);
  mock.timers.tick(1000);
  await flush();
  assert.ok(sync.data.cfg_meta);
  assert.equal(JSON.parse(sync.data.cfg_0).settings.historyLimit, 12);
});

test('a Tools menu item opens its view and other menu items are ignored', async () => {
  browser.menus.onClicked.emit({ menuItemId: 'view:broken' });
  browser.menus.onClicked.emit({ menuItemId: 'root' });
  browser.menus.onClicked.emit({ menuItemId: 42 });
  await flush();
  assert.deepEqual(openedUrls(), [dashboard('broken')]);
});

test('the address-bar keyword suggests every view for empty input and filters by id or title', () => {
  const suggest = (text) => {
    let out;
    browser.omnibox.onInputChanged.emit(text, (list) => { out = list; });
    return out;
  };
  assert.equal(suggest('  ').length, 12);
  assert.deepEqual(suggest('DUP '), [{ content: 'duplicates', description: 'Duplicates' }]);
  assert.deepEqual(suggest('links'), [{ content: 'broken', description: 'Broken links' }]);
  assert.deepEqual(suggest('zzz'), []);
});

test('the address-bar keyword opens an exact view, else the first view it begins, else the dashboard', async () => {
  for (const text of ['History', 'red', 'e', 'nonsense']) browser.omnibox.onInputEntered.emit(text);
  await flush();
  assert.deepEqual(openedUrls(), ['history', 'redirects', 'empty-folders', 'stats'].map(dashboard));
});

test('a new bookmark is organized by rule four seconds after it is added', async () => {
  await local.set({ settings: autoSettings() });
  const node = await browser.bookmarks.create({ parentId: 'menu________', title: 'Rust book', url: 'https://rust.test/' });
  mock.timers.tick(3999);
  await flush();
  assert.equal(await parentOf(node.id), 'menu________');
  mock.timers.tick(1);
  await flush();
  const [dev] = (await browser.bookmarks.getChildren('unfiled_____')).filter((n) => n.title === 'Dev');
  assert.equal(await parentOf(node.id), dev.id);
  assert.equal(local.data.history.entries[0].label, 'Auto-organized “Rust book”');
});

test('a bookmark without a title is named by its URL in the undo history', async () => {
  await local.set({ settings: autoSettings() });
  await browser.bookmarks.create({ parentId: 'menu________', title: '', url: 'https://rust.test/untitled' });
  mock.timers.tick(4000);
  await flush();
  assert.equal(local.data.history.entries[0].label, 'Auto-organized “https://rust.test/untitled”');
});

test('bookmarks added close together are organized as one undoable step once the last has waited', async () => {
  await local.set({ settings: autoSettings() });
  const first = await browser.bookmarks.create({ parentId: 'toolbar_____', title: 'Rust one', url: 'https://rust.test/1' });
  mock.timers.tick(3000);
  const second = await browser.bookmarks.create({ parentId: 'toolbar_____', title: 'Rust two', url: 'https://rust.test/2' });
  mock.timers.tick(3000);
  await flush();
  assert.equal(await parentOf(first.id), 'toolbar_____');
  mock.timers.tick(1000);
  await flush();
  assert.notEqual(await parentOf(first.id), 'toolbar_____');
  assert.equal(await parentOf(first.id), await parentOf(second.id));
  assert.equal(local.data.history.entries.length, 1);
  assert.equal(local.data.history.entries[0].label, 'Auto-organized 2 new bookmarks');
});

test('a new folder neither waits to be organized nor delays the bookmarks before it', async () => {
  await local.set({ settings: autoSettings() });
  const node = await browser.bookmarks.create({ parentId: 'toolbar_____', title: 'Rust three', url: 'https://rust.test/3' });
  mock.timers.tick(3000);
  await browser.bookmarks.create({ parentId: 'toolbar_____', title: 'Rust folder' });
  mock.timers.tick(1000);
  await flush();
  assert.notEqual(await parentOf(node.id), 'toolbar_____');
  assert.ok((await childTitles('toolbar_____')).includes('Rust folder'));
});

test('a bookmark moved elsewhere before the wait ends, as by the star panel, stays where it was put', async () => {
  await local.set({ settings: autoSettings() });
  const node = await browser.bookmarks.create({ parentId: 'menu________', title: 'Rust moved', url: 'https://rust.test/moved' });
  await browser.bookmarks.move(node.id, { parentId: 'mobile______' });
  mock.timers.tick(4000);
  await flush();
  assert.equal(await parentOf(node.id), 'mobile______');
  assert.equal(local.data.history, undefined);
});

test('nothing is organized when automatic organizing is off or there are no rules', async () => {
  for (const organize of [{ autoApply: false, rules: [rule('dev', 'rust', 'Dev')] }, { autoApply: true, rules: [] }]) {
    await local.set({ settings: { organize } });
    const node = await browser.bookmarks.create({ parentId: 'menu________', title: 'Rust off', url: 'https://rust.test/off' });
    mock.timers.tick(4000);
    await flush();
    assert.equal(await parentOf(node.id), 'menu________');
  }
  assert.equal(local.data.history, undefined);
});

test('more than twenty bookmarks at once, as from an import, are left alone', async () => {
  await local.set({ settings: autoSettings() });
  const ids = [];
  for (let i = 0; i < 21; i++) ids.push((await browser.bookmarks.create({ parentId: 'mobile______', title: `Rust ${i}`, url: `https://rust.test/burst/${i}` })).id);
  mock.timers.tick(4000);
  await flush();
  for (const id of ids) assert.equal(await parentOf(id), 'mobile______');
  assert.equal(local.data.history, undefined);
});

test('a bookmark brought back by undo is not organized again', async () => {
  await local.set({ settings: autoSettings() });
  const node = await browser.bookmarks.create({ parentId: 'menu________', title: 'Rust restored', url: 'https://rust.test/restored' });
  await local.set({ history: { entries: [], redo: [], idMap: { old: node.id } } });
  mock.timers.tick(4000);
  await flush();
  assert.equal(await parentOf(node.id), 'menu________');
  assert.deepEqual(local.data.history.entries, []);
});

test('an ignored bookmark is not organized', async () => {
  await local.set({ settings: autoSettings() });
  const node = await browser.bookmarks.create({ parentId: 'menu________', title: 'Rust ignored', url: 'https://rust.test/ignored' });
  await local.set({ whitelist: { [node.id]: { title: 'Rust ignored', url: 'https://rust.test/ignored' } } });
  mock.timers.tick(4000);
  await flush();
  assert.equal(await parentOf(node.id), 'menu________');
});

test('a new bookmark no rule matches stays put and adds nothing to the undo history', async () => {
  await local.set({ settings: autoSettings() });
  const node = await browser.bookmarks.create({ parentId: 'menu________', title: 'Cooking', url: 'https://food.test/' });
  mock.timers.tick(4000);
  await flush();
  assert.equal(await parentOf(node.id), 'menu________');
  assert.equal(local.data.history, undefined);
});

test('a failure while organizing new bookmarks is logged instead of thrown', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  await local.set({ settings: autoSettings() });
  await browser.bookmarks.create({ parentId: 'menu________', title: 'Rust broken', url: 'https://rust.test/broken' });
  const { getTree } = browser.bookmarks;
  browser.bookmarks.getTree = async () => { throw new Error('no tree'); };
  try {
    mock.timers.tick(4000);
    await flush();
  } finally {
    browser.bookmarks.getTree = getTree;
  }
  assert.equal(error.mock.calls[0].arguments[0], 'Auto-organize failed');
});

test('a settings or ignore-list change is uploaded to sync after a one-second pause', async () => {
  await local.set({ settings: { historyLimit: 5 } });
  await local.set({ whitelist: { a: { title: 'Alpha', url: '' } } });
  mock.timers.tick(999);
  await flush();
  assert.equal(sync.data.cfg_meta, undefined);
  mock.timers.tick(1);
  await flush();
  assert.deepEqual(JSON.parse(sync.data.cfg_0), { settings: { historyLimit: 5 }, whitelist: { a: { title: 'Alpha', url: '' } } });
  assert.equal(local.data.syncState.hash, sync.data.cfg_meta.hash);
});

test('changes to other stored data are not uploaded', async () => {
  await local.set({ history: { entries: [], idMap: {}, redo: [] }, linkResults: [] });
  mock.timers.tick(1000);
  await flush();
  assert.deepEqual(sync.data, {});
});

test('nothing is uploaded while sync is turned off', async () => {
  await local.set({ syncEnabled: false });
  await local.set({ settings: { historyLimit: 5 } });
  mock.timers.tick(1000);
  await flush();
  assert.deepEqual(sync.data, {});
});

test('settings synced from another device are applied here after a one-second pause', async () => {
  const text = JSON.stringify({ settings: { historyLimit: 77 }, whitelist: { z: { title: 'Zed', url: '' } } });
  await sync.set({ cfg_0: text });
  await sync.set({ cfg_meta: { hash: fingerprint(text), chunks: 1, updated: 1, partial: false } });
  mock.timers.tick(999);
  await flush();
  assert.equal(local.data.settings, undefined);
  mock.timers.tick(1);
  await flush();
  assert.deepEqual(local.data.settings, { historyLimit: 77 });
  assert.deepEqual(local.data.whitelist, { z: { title: 'Zed', url: '' } });
  // Applying them is itself a local change, which finds nothing new to upload.
  mock.timers.tick(1000);
  await flush();
  assert.equal(sync.data.cfg_meta.updated, 1);
});

test('sync items that are not settings chunks are ignored', async () => {
  await sync.set({ other: 1 });
  mock.timers.tick(1000);
  await flush();
  assert.equal(local.data.syncState, undefined);
});

test('a sync upload that fails is recorded for the settings page to show', async () => {
  const { set } = sync;
  sync.set = async () => { throw new Error('quota exceeded'); };
  try {
    await local.set({ settings: { historyLimit: 5 } });
    mock.timers.tick(1000);
    await flush();
  } finally {
    sync.set = set;
  }
  assert.equal(local.data.syncState.error, 'quota exceeded');
});

test('startup takes the synced copy when it differs from what this device last saw', async () => {
  const text = JSON.stringify({ settings: { historyDays: 3 }, whitelist: {} });
  sync.data.cfg_0 = text;
  sync.data.cfg_meta = { hash: fingerprint(text), chunks: 1, updated: 1, partial: false };
  browser.runtime.onStartup.emit();
  await flush();
  mock.timers.tick(1000);
  await flush();
  assert.deepEqual(local.data.settings, { historyDays: 3 });
});

test('startup forgets undo history older than the age limit', async () => {
  const day = 24 * 60 * 60 * 1000;
  const entry = (id, age) => ({ id, time: Date.now() - age * day, label: id, ops: [] });
  await local.set({ settings: { historyDays: 2 }, history: { entries: [entry('new', 1), entry('old', 5)], idMap: {}, redo: [] } });
  browser.runtime.onStartup.emit();
  await flush();
  assert.deepEqual(local.data.history.entries.map((e) => e.id), ['new']);
});

test('a failure while forgetting old undo history at startup is logged instead of thrown', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const { get } = local;
  local.get = async () => { throw new Error('locked'); };
  try {
    browser.runtime.onStartup.emit();
    await flush();
  } finally {
    local.get = get;
  }
  assert.equal(error.mock.calls[0].arguments[0], 'Clearing old undo history failed');
});
