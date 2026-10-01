// A page DOM and a fake WebExtension `browser` on globalThis, so UI modules and the background script load in tests.

import { readFileSync } from 'node:fs';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { fakeBookmarks, fakeStorage } from './fake-browser.js';

// An extension event: tests read `listeners` and call `emit` to fire it.
export function fakeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(fn) { listeners.push(fn); },
    removeListener(fn) { if (listeners.includes(fn)) listeners.splice(listeners.indexOf(fn), 1); },
    hasListener(fn) { return listeners.includes(fn); },
    emit(...args) { return [...listeners].map((fn) => fn(...args)); },
  };
}

// Wraps a storage area so every write fires browser.storage.onChanged with that area's name.
function watched(storage, area, onChanged) {
  const changes = (keys, before) => Object.fromEntries(keys.map((k) => [k, { oldValue: before[k], newValue: storage.data[k] }]));
  return {
    ...storage,
    async set(obj) {
      const before = { ...storage.data };
      await storage.set(obj);
      onChanged.emit(changes(Object.keys(obj), before), area);
    },
    async remove(keys) {
      const before = { ...storage.data };
      await storage.remove(keys);
      onChanged.emit(changes([keys].flat(), before), area);
    },
  };
}

// Wraps fake bookmarks so changes fire the matching browser.bookmarks events.
function eventful(bookmarks) {
  const events = { onCreated: fakeEvent(), onRemoved: fakeEvent(), onChanged: fakeEvent(), onMoved: fakeEvent() };
  return {
    ...bookmarks,
    ...events,
    async create(props) {
      const node = await bookmarks.create(props);
      events.onCreated.emit(node.id, node);
      return node;
    },
    async update(id, changes) {
      const node = await bookmarks.update(id, changes);
      events.onChanged.emit(id, changes);
      return node;
    },
    async move(id, dest) {
      const node = await bookmarks.move(id, dest);
      events.onMoved.emit(id, dest);
      return node;
    },
    async remove(id) {
      await bookmarks.remove(id);
      events.onRemoved.emit(id, {});
    },
    async removeTree(id) {
      await bookmarks.removeTree(id);
      events.onRemoved.emit(id, {});
    },
  };
}

// The default bookmark tree: the four Firefox roots with a few bookmarks.
export const defaultTree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'a', title: 'Alpha', url: 'https://alpha.test/' },
    { id: 'b', title: 'Beta', url: 'https://beta.test/' },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

// Every API the add-on calls, recording calls in `calls` so tests can check what happened.
export function fakeBrowser({ tree = defaultTree(), granted = true } = {}) {
  const calls = [];
  const record = (name, result) => (...args) => { calls.push([name, ...args]); return typeof result === 'function' ? result(...args) : result; };
  const onChanged = fakeEvent();
  const tabs = [];
  return {
    calls,
    bookmarks: eventful(fakeBookmarks(tree)),
    storage: {
      local: watched(fakeStorage(), 'local', onChanged),
      sync: watched(fakeStorage(), 'sync', onChanged),
      onChanged,
    },
    runtime: {
      getURL: (path) => `moz-extension://test/${path}`,
      sendMessage: record('runtime.sendMessage', async () => false),
      onInstalled: fakeEvent(),
      onStartup: fakeEvent(),
      onMessage: fakeEvent(),
    },
    tabs: {
      create: record('tabs.create', async (props) => { const tab = { id: tabs.length + 1, windowId: 1, ...props }; tabs.push(tab); return tab; }),
      update: record('tabs.update', async (id, props) => ({ id, ...props })),
      query: record('tabs.query', async () => tabs),
      getCurrent: record('tabs.getCurrent', async () => ({ id: 7, windowId: 3 })),
    },
    windows: {
      create: record('windows.create', async (props) => ({ id: 2, ...props })),
      update: record('windows.update', async (id, props) => ({ id, ...props })),
    },
    permissions: {
      request: record('permissions.request', async () => granted),
      contains: record('permissions.contains', async () => granted),
    },
    history: { search: record('history.search', async () => []) },
    contextualIdentities: { query: record('contextualIdentities.query', async () => []) },
    menus: { create: record('menus.create'), removeAll: record('menus.removeAll'), onClicked: fakeEvent() },
    omnibox: { setDefaultSuggestion: record('omnibox.setDefaultSuggestion'), onInputChanged: fakeEvent(), onInputEntered: fakeEvent() },
    commands: { onCommand: fakeEvent() },
    action: { onClicked: fakeEvent() },
  };
}

// Registers a DOM on globalThis, loading the body of an HTML file from src/ui when one is named.
export function installDom({ page, url = 'moz-extension://test/src/ui/app.html' } = {}) {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url, width: 1280, height: 800 });
  if (page) {
    const html = readFileSync(new URL(`../src/ui/${page}`, import.meta.url), 'utf8');
    document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  }
}

// Installs a DOM and a fake browser together and returns the browser.
export function installBrowser(options = {}) {
  installDom(options);
  globalThis.browser = fakeBrowser(options);
  return globalThis.browser;
}

// Lets pending promises and zero-delay timers run.
export const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// Closes the DOM, cancelling its timers so a pending toast does not hold the test process open.
export async function uninstallDom() {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
}
