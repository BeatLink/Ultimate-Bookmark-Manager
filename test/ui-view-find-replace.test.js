import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom, settle } from './browser-env.js';
import { openDashboard, main, click, findButton, tick, selectedCount, toasts, clearToasts, show } from './ui-view-helpers.js';

const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'a', title: 'Old wiki', url: 'http://wiki.old.test/page' },
    { id: 'b', title: 'Old news', url: 'https://news.test/' },
    { id: 'c', title: 'Shop', url: 'https://shop.old.test/' },
    { id: 'f', title: 'Old folder', children: [] },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

const browser = await openDashboard({ view: 'find-replace', tree: tree() });
after(uninstallDom);

const field = (label) => [...main().querySelectorAll('.find-field')].find((l) => l.textContent.startsWith(label)).querySelector('input');
const type = async (label, value) => {
  const input = field(label);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(5);
};
const toggle = async (label) => {
  const box = [...main().querySelectorAll('.check-line')].find((l) => l.textContent === label).querySelector('input');
  box.checked = !box.checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(5);
};
const lookIn = async (value) => {
  const select = main().querySelector('.find-form select');
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(5);
};
const listed = () => [...main().querySelectorAll('.items > .item')].map((li) => li.querySelector('input[data-sel]')?.dataset.sel ?? 'disabled');
const node = async (id) => (await browser.bookmarks.get(id))[0];

test('the page asks for text to find before listing anything', () => {
  assert.equal(main().querySelector('.empty-state').textContent, 'Type the text to find.');
  assert.equal(main().querySelector('.selection-bar'), null);
});

test('typing lists every bookmark that would change, highlighting the text before and after', async () => {
  await type('Find', 'old');
  await type('Replace with', 'new');
  assert.deepEqual(listed(), ['a', 'b', 'c'], 'folders are left alone');
  const row = main().querySelector('input[data-sel="a"]').closest('.item');
  assert.deepEqual([...row.querySelectorAll('.bm mark')].map((m) => m.textContent), ['Old', 'old']);
  assert.equal(row.querySelector('.replaced .bm-title').textContent, 'new wiki');
  assert.equal(row.querySelector('.replaced .bm-url').textContent, 'http://wiki.new.test/page');
  assert.deepEqual([...row.querySelectorAll('.replaced mark')].map((m) => m.textContent), ['new', 'new']);
  assert.equal(field('Find').value, 'old', 'typing redraws the list but keeps the form');
});

test('Match case and Look in narrow what is found', async () => {
  await toggle('Match case');
  assert.deepEqual(listed(), ['a', 'c']);
  await lookIn('title');
  assert.equal(main().querySelector('.empty-state').textContent, 'No bookmarks would change.');
  await toggle('Match case');
  assert.deepEqual(listed(), ['a', 'b']);
  assert.equal(main().querySelector('input[data-sel="a"]').closest('.item').querySelector('.replaced .bm-url'), null);
  await lookIn('both');
});

test('an invalid regex is reported instead of a list', async () => {
  await toggle('Regex');
  await type('Find', '(old');
  assert.match(main().querySelector('p.error').textContent, /^Invalid regex: /);
  await type('Find', 'old');
  await toggle('Regex');
});

test('Replace selected changes just the ticked bookmarks, as one undoable step', async () => {
  clearToasts();
  assert.equal(findButton('Replace selected').disabled, true);
  tick('b');
  assert.equal(selectedCount(), '1 selected');
  await click('Replace selected');
  assert.equal((await node('b')).title, 'new news');
  assert.equal((await node('a')).title, 'Old wiki');
  assert.match(toasts(), /Changed 1 bookmark\(s\)\./);
  assert.equal(browser.storage.local.data.history.entries[0].label, 'Replaced “old” with “new” in 1 bookmark(s)');
  assert.deepEqual(listed(), ['a', 'c'], 'the search is kept after the change');
});

test('a change that would break a URL is shown but cannot be made', async () => {
  await toggle('Regex');
  await type('Find', '^https://shop.*');
  await type('Replace with', 'shop');
  assert.deepEqual(listed(), ['disabled']);
  assert.match(main().querySelector('p.warn').textContent, /1 bookmark\(s\) would get a URL that is not a valid address/);
  assert.equal(findButton('Replace all (0)').disabled, true);
  assert.equal(findButton('Select all').disabled, false);
  await toggle('Regex');
});

test('Replace all uses the regex groups and the search survives a visit elsewhere', async () => {
  await toggle('Regex');
  await type('Find', '^http://(\\w+)\\.old');
  await type('Replace with', 'https://$1.new');
  await show('help');
  await show('find-replace');
  assert.equal(field('Find').value, '^http://(\\w+)\\.old');
  assert.deepEqual(listed(), ['a']);
  await click('Replace all (1)');
  assert.equal((await node('a')).url, 'https://wiki.new.test/page');
  assert.equal(main().querySelector('.empty-state').textContent, 'No bookmarks would change.');
});
