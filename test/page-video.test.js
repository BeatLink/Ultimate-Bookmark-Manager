import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom, fakeEvent } from './browser-env.js';
import { longestVideo, pageVideoLength, NO_VIDEO } from '../src/lib/page-video.js';
import { loadPageLengths, worthOpening, NO_LENGTH } from '../src/lib/video-lengths.js';

before(() => installDom());
after(() => uninstallDom());

// A <video> whose length is already known as `duration`.
const video = (duration, props = {}) => {
  const el = document.createElement('video');
  Object.defineProperty(el, 'duration', { value: duration, configurable: true });
  Object.defineProperty(el, 'readyState', { value: props.readyState ?? 1 });
  if (props.preload) el.preload = props.preload;
  if (props.src) el.src = props.src;
  document.body.append(el);
  return el;
};

// A tab API that records what it is asked to do; `frames(url)` gives what each frame's script returns.
const fakeApi = ({ frames = () => [{ result: 0 }], status = 'complete', create, get } = {}) => {
  const calls = [];
  const tabs = new Map();
  return {
    calls,
    tabs: {
      create: create ?? (async (props) => { const tab = { id: tabs.size + 1, ...props }; tabs.set(tab.id, tab); calls.push(['create', props.url]); return tab; }),
      update: async (id, props) => calls.push(['update', id, props]),
      get: get ?? (async (id) => ({ ...tabs.get(id), status })),
      remove: async (id) => calls.push(['remove', id]),
      onUpdated: fakeEvent(),
    },
    windows: {
      create: async (props) => { calls.push(['window', props]); return { id: 9 }; },
      remove: async (id) => calls.push(['close window', id]),
    },
    scripting: { executeScript: async ({ target }) => frames(tabs.get(target.tabId).url) },
  };
};

test('the longest video with a known length wins; live streams and loading videos have none', async () => {
  video(30);
  video(125.6);
  video(Infinity);
  video(NaN);
  assert.equal(await longestVideo(0), 125.6);
  document.body.replaceChildren();
});

test('a frame waits for a video to learn its length, and gives up with 0', async () => {
  assert.equal(await longestVideo(0), 0);
  setTimeout(() => video(42), 100);
  assert.equal(await longestVideo(2000), 42);
  document.body.replaceChildren();
});

test('a video told not to preload is asked for its length', async () => {
  const el = video(NaN, { readyState: 0, preload: 'none', src: 'https://v.test/a.mp4' });
  let loads = 0;
  el.load = () => loads++;
  const bare = video(NaN, { readyState: 0, preload: 'none' });
  assert.equal(await longestVideo(0), 0);
  assert.equal(el.preload, 'metadata');
  assert.equal(loads, 1);
  assert.equal(bare.preload, 'none');
  document.body.replaceChildren();
});

test('an opened page gives its longest video across frames, in a muted tab that is closed again', async () => {
  const api = fakeApi({ frames: (url) => (url === 'https://v.test/' ? [{ result: 12 }, { result: 300.4 }, { error: 'x' }] : [{ result: 0 }]) });
  assert.deepEqual(await pageVideoLength('https://v.test/', { windowId: 9, api }), { seconds: 300 });
  assert.deepEqual(api.calls, [['create', 'https://v.test/'], ['update', 1, { muted: true }], ['remove', 1]]);
  assert.deepEqual(await pageVideoLength('https://none.test/', { api }), { error: NO_VIDEO });
});

test('the page is read once it finishes loading, or when the wait runs out', async () => {
  const api = fakeApi({ status: 'loading', frames: () => [{ result: 5 }] });
  const reading = pageVideoLength('https://slow.test/', { api });
  await new Promise((r) => setTimeout(r, 10));
  api.tabs.onUpdated.emit(99, {}, { status: 'complete', url: 'https://other.test/' });
  api.tabs.onUpdated.emit(1, {}, { status: 'complete', url: 'about:blank' });
  assert.equal(api.tabs.onUpdated.listeners.length, 1);
  api.tabs.onUpdated.emit(1, {}, { status: 'complete', url: 'https://slow.test/' });
  assert.deepEqual(await reading, { seconds: 5 });
  assert.equal(api.tabs.onUpdated.listeners.length, 0);

  const stuck = fakeApi({ get: async () => { throw new Error('gone'); }, frames: () => [{ result: 7 }] });
  assert.deepEqual(await pageVideoLength('https://stuck.test/', { api: stuck }), { seconds: 7 });
  const never = fakeApi({ status: 'loading', frames: () => [{ result: 8 }] });
  assert.deepEqual(await pageVideoLength('https://never.test/', { api: never, loadWait: 20 }), { seconds: 8 });
});

test('a page that cannot be opened or read, or a cancelled search, says why', async () => {
  const closed = fakeApi({ create: async () => { throw new Error('no window'); } });
  assert.deepEqual(await pageVideoLength('https://v.test/', { api: closed }), { error: 'Could not open the page' });
  const blocked = fakeApi({ frames: () => { throw new Error('Missing host permission'); } });
  assert.deepEqual(await pageVideoLength('https://v.test/', { api: blocked }), { error: 'Could not read the opened page' });
  assert.deepEqual(blocked.calls.at(-1), ['remove', 1]);

  const controller = new AbortController();
  const api = fakeApi({ status: 'loading' });
  const reading = pageVideoLength('https://v.test/', { api, signal: controller.signal });
  await new Promise((r) => setTimeout(r, 10));
  controller.abort();
  assert.deepEqual(await reading, { error: 'Cancelled' });
});

test('many pages open in one minimized window that is closed afterwards', async () => {
  const api = fakeApi({ frames: (url) => [{ result: url === 'https://a.test/' ? 61 : 0 }] });
  const done = [];
  const results = await loadPageLengths([{ id: 'a', url: 'https://a.test/' }, { id: 'b', url: 'https://b.test/' }], { api, onProgress: (n) => done.push(n) });
  assert.deepEqual(Object.fromEntries(results), { a: { seconds: 61 }, b: { error: NO_VIDEO } });
  assert.deepEqual(done, [1, 2]);
  assert.deepEqual(api.calls[0], ['window', { state: 'minimized' }]);
  assert.deepEqual(api.calls.at(-1), ['close window', 9]);
});

test('only web pages still missing a length are worth opening', () => {
  assert.equal(worthOpening({ error: NO_LENGTH }), true);
  assert.equal(worthOpening({ error: 'Forbidden' }), true);
  assert.equal(worthOpening({ seconds: 5 }), false);
  assert.equal(worthOpening({ error: 'Not a web page' }), false);
  assert.equal(worthOpening({ error: 'Cancelled' }), false);
});
