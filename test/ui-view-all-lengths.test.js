import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom } from './browser-env.js';
import { fakeFetch } from './fake-fetch.js';
import { startAll, idle, rowIds, rowEl, headLabels, toolbarButton, lastToast, cell, pick, rightClick, menuItems, choose, closeMenu } from './ui-view-all-helpers.js';

const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'v1', title: 'Talk', url: 'https://video.test/talk' },
    { id: 'f1', title: 'Videos', children: [
      { id: 'v2', title: 'Short', url: 'https://video.test/short' },
      { id: 'n1', title: 'Article', url: 'https://text.test/' },
      { id: 'home', title: 'Router', url: 'http://192.168.1.1/' },
    ] },
    { id: 'gone', title: 'Gone', url: 'https://gone.test/' },
  ] },
];

const pages = {
  'https://video.test/talk': { html: '<meta property="og:video:duration" content="3723">' },
  'https://video.test/short': { html: '<meta itemprop="duration" content="PT1M5S">' },
  'https://text.test/': { html: '<title>Words</title>' },
  'https://gone.test/': { status: 404 },
};
const realFetch = globalThis.fetch;
const header = (text) => [...document.querySelectorAll('.bm-tree-head button')].find((b) => b.textContent.startsWith(text));
const meta = () => document.querySelector('.details-meta').textContent;

before(async () => {
  await startAll(tree(), { saved: { 'all.expanded': ['menu________', 'f1'] } });
  globalThis.fetch = fakeFetch(pages);
});
after(() => {
  globalThis.fetch = realFetch;
  uninstallDom();
});

test('finding video lengths needs website access', async () => {
  browser.permissions.request = async () => false;
  pick('v1');
  rightClick('v1');
  choose('Find video lengths');
  await idle();
  assert.equal(lastToast(), 'Finding video lengths needs permission to access websites.');
  assert.equal(rowEl('v1').querySelector('.cell.length'), null);
});

test('a folder’s bookmarks get their lengths, the column turns on and sorts by them', async () => {
  browser.permissions.request = async () => true;
  pick('f1');
  rightClick('f1');
  choose('Find video lengths');
  await idle(80);
  assert.equal(lastToast(), 'Found the video length of 1 of 2 page(s). 1 had none; select one to see why. 1 skipped by the link check’s settings.');
  assert.deepEqual(headLabels(), ['Name', 'Location', 'Added', 'Video length']);
  assert.equal(cell('v2', 'length'), '1:05');
  assert.equal(cell('v1', 'length'), '');
  assert.match(localStorage.getItem('all.columns'), /"length":true/);
  assert.deepEqual(await browser.storage.local.get('videoLengths'), { videoLengths: { v2: { url: 'https://video.test/short', seconds: 65 } } });

  pick('n1');
  assert.match(meta(), /No video length on the page/);
  pick('v2');
  assert.match(meta(), /Video 1:05/);
});

test('a selection with several bookmarks adds to the saved lengths', async () => {
  pick('v1');
  pick('gone', { ctrlKey: true });
  rightClick('gone');
  choose('Find video lengths');
  await idle(80);
  assert.equal(lastToast(), 'Found the video length of 1 of 2 page(s). 1 had none; select one to see why.');
  assert.equal(cell('v1', 'length'), '1:02:03');
  assert.equal(cell('v2', 'length'), '1:05');
  pick('gone');
  assert.match(meta(), /No video length: Not found/);

  header('Video length').click();
  header('Video length').click();
  assert.deepEqual(rowIds().slice(0, 3), ['menu________', 'v1', 'f1']);
  header('Video length').click();
});

test('pages the link check skips, or a selection with no bookmarks, find nothing', async () => {
  pick('home');
  rightClick('home');
  choose('Find video lengths');
  await idle();
  assert.equal(lastToast(), 'The link check skips every selected page, so it has no length to find.');
  rightClick();
  assert.ok(menuItems().includes('Find video lengths (off)'));
  closeMenu();
});

test('found lengths can be written into names and taken off again, each as one undoable step', async () => {
  pick('f1');
  rightClick('f1');
  assert.ok(menuItems().includes('Remove video length from names (off)'));
  choose('Add video length to names');
  await idle();
  assert.equal(lastToast(), 'Added the video length to 1 name(s).');
  assert.equal((await browser.bookmarks.get('v2'))[0].title, '[1:05] Short');
  assert.equal((await browser.bookmarks.get('n1'))[0].title, 'Article');
  rightClick('f1');
  assert.ok(menuItems().includes('Add video length to names (off)'));
  choose('Remove video length from names');
  await idle();
  assert.equal(lastToast(), 'Removed the video length from 1 name(s).');
  assert.equal((await browser.bookmarks.get('v2'))[0].title, 'Short');
});

test('lengths saved in another window show, and the column can be hidden again', async () => {
  await browser.storage.local.set({ videoLengths: { v1: { url: 'https://video.test/talk', seconds: 30 } } });
  await idle(700);
  assert.equal(cell('v1', 'length'), '0:30');
  toolbarButton('Columns ▾').click();
  choose('Video length');
  assert.deepEqual(headLabels(), ['Name', 'Location', 'Added']);
});

test('opening full pages needs permission to run scripts in them', async () => {
  browser.permissions.request = async () => false;
  pick('n1');
  rightClick('n1');
  choose('Find video lengths in full pages');
  await idle();
  assert.equal(lastToast(), 'Opening pages to find video lengths needs permission to access websites and run scripts in them.');
});

test('pages whose HTML names no length are opened in a hidden window and their videos read', async () => {
  browser.permissions.request = async (asked) => asked.permissions?.includes('scripting') && asked.origins?.includes('<all_urls>');
  browser.scripting.executeScript = async ({ target }) => [{ result: (await browser.tabs.get(target.tabId)).url === 'https://text.test/' ? 90 : 0 }];
  pick('n1');
  pick('gone', { ctrlKey: true });
  pick('v2', { ctrlKey: true });
  rightClick('n1');
  choose('Find video lengths in full pages');
  await idle(120);
  assert.equal(lastToast(), 'Found the video length of 2 of 3 page(s). 1 had none; select one to see why.');
  assert.equal(cell('n1', 'length'), '1:30');
  assert.equal(cell('v2', 'length'), '1:05');
  const opened = browser.calls.filter(([name]) => name === 'tabs.create').map(([, props]) => props.url);
  assert.deepEqual(opened, ['https://text.test/', 'https://gone.test/']);
  assert.ok(browser.calls.some(([name, props]) => name === 'windows.create' && props.state === 'minimized'));
  assert.ok(browser.calls.some(([name]) => name === 'windows.remove'));
  pick('gone');
  assert.match(meta(), /No video length: Not found/);
});
