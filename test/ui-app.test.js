import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, settle, uninstallDom } from './browser-env.js';

const browser = installBrowser({
  page: 'app.html',
  tree: [
    { id: 'menu________', title: 'Bookmarks Menu', children: [
      { id: 'a', title: 'Alpha', url: 'https://alpha.test/' },
      { id: 'a2', title: 'Alpha copy', url: 'https://alpha.test/' },
      { id: 'e1', title: 'Empty one', children: [] },
      { id: 'e2', title: 'Empty two', children: [] },
    ] },
    { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [] },
    { id: 'unfiled_____', title: 'Other Bookmarks', children: [] },
    { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
  ],
});

// Counts tree reads, so tests can tell whether the page reloaded its data.
let treeReads = 0;
const getTree = browser.bookmarks.getTree;
browser.bookmarks.getTree = (...args) => { treeReads++; return getTree(...args); };

await import('../src/ui/app.js');
const { confirmDialog } = await import('../src/ui/dom.js');
await settle(20);

afterEach(() => {
  document.getElementById('toasts').replaceChildren();
  for (const dialog of document.querySelectorAll('dialog')) dialog.remove();
});
after(uninstallDom);

const main = () => document.getElementById('main');
const toasts = () => [...document.querySelectorAll('#toasts .toast')].map((t) => t.firstChild.textContent);
const toastButton = (text) => [...document.querySelectorAll('#toasts .toast')].find((t) => t.textContent.startsWith(text))?.querySelector('button');
const buttonNamed = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);
const navLink = (id) => document.querySelector(`#nav a[href="#${id}"]`);

// Leaves exactly the given checkboxes ticked on the current page.
function tickOnly(...boxes) {
  for (const box of main().querySelectorAll('input[data-sel]')) if (box.checked !== boxes.includes(box)) box.click();
}

// Moves to a page through the address hash and waits for it to draw.
async function visit(hash) {
  location.hash = hash;
  await settle(5);
}

// Waits until the page has drawn the given view again after a change.
async function waitFor(check, tries = 50) {
  for (let i = 0; i < tries && !check(); i++) await settle(5);
  assert.ok(check(), 'condition never became true');
}

test('the dashboard opens on the first page with every page listed in the navigation', () => {
  assert.equal(main().dataset.view, 'stats');
  assert.equal(document.title, 'Dashboard — Ultimate Bookmark Manager');
  assert.equal(document.body.classList.contains('sidebar'), false);
  const links = [...document.querySelectorAll('#nav a')];
  assert.equal(links.length, 12);
  assert.equal(links[0].className, 'active');
  assert.equal(links[0].getAttribute('aria-current'), 'page');
  assert.equal(links[1].hasAttribute('aria-current'), false);
  const options = [...document.querySelectorAll('#nav-select option')];
  assert.equal(options.length, 12);
  assert.equal(options[0].selected, true);
  assert.equal(options.find((o) => o.value === 'help').textContent, 'Help');
});

test('navigation badges count what each scan found', () => {
  assert.equal(navLink('duplicates').querySelector('.badge').textContent, '1');
  assert.equal(navLink('empty-folders').querySelector('.badge').textContent, '2');
  assert.equal(navLink('broken').querySelector('.badge').textContent, '');
  assert.equal(navLink('help').querySelector('.badge'), null);
});

test('changing the address hash shows that page and marks it in the navigation', async () => {
  await visit('empty-folders');
  assert.equal(main().dataset.view, 'empty-folders');
  assert.equal(main().querySelector('h1').textContent, 'Empty folders');
  assert.equal(document.title, 'Empty folders — Ultimate Bookmark Manager');
  assert.equal(navLink('empty-folders').className, 'active');
});

test('an unknown page falls back to the first one', async () => {
  await visit('no-such-page');
  assert.equal(main().dataset.view, 'stats');
});

test('a help address opens the Help page at the named section', async (t) => {
  const scrolled = [];
  t.mock.method(Element.prototype, 'scrollIntoView', function () { scrolled.push(this.id); });
  await visit('help:organize');
  await settle(5);
  assert.equal(main().dataset.view, 'help');
  assert.deepEqual(scrolled, ['help-organize']);
});

test('picking a page from the compact menu goes there', async () => {
  const picker = document.getElementById('nav-select');
  picker.value = 'duplicates';
  picker.dispatchEvent(new Event('change'));
  await settle(5);
  assert.equal(location.hash, '#duplicates');
  assert.equal(main().dataset.view, 'duplicates');
});

test('the open-in-a-tab button opens the current page in a new tab', () => {
  document.getElementById('open-tab').click();
  assert.deepEqual(browser.calls.at(-1), ['tabs.create', { url: 'moz-extension://test/src/ui/app.html#duplicates' }]);
});

test('a re-render keeps the scroll position on the same page and goes to the top on a new one', async (t) => {
  const scrolls = [];
  t.mock.method(window, 'scrollTo', (x, y) => scrolls.push(y));
  Object.defineProperty(window, 'scrollY', { value: 250, configurable: true });
  document.querySelector('[data-action=reload]').click();
  await waitFor(() => toasts().length > 0);
  await visit('stats');
  delete window.scrollY;
  assert.deepEqual(scrolls, [250, 0]);
});

test('the reload buttons re-read the bookmarks and say how many there are', async () => {
  const before = treeReads;
  const buttons = document.querySelectorAll('[data-action=reload]');
  assert.equal(buttons.length, 2);
  buttons[1].click();
  assert.equal(document.body.classList.contains('busy'), true);
  await waitFor(() => toasts().length > 0);
  assert.equal(document.body.classList.contains('busy'), false);
  assert.equal(treeReads, before + 1);
  assert.deepEqual(toasts(), ['Reloaded 2 bookmarks.']);
  assert.equal(document.querySelector('#toasts .toast').className, 'toast success');
});

test('a reload that cannot read the bookmarks says so', async (t) => {
  t.mock.method(console, 'error', () => {});
  browser.bookmarks.getTree = async () => { throw new Error('Tree unavailable'); };
  document.querySelector('[data-action=reload]').click();
  await waitFor(() => toasts().length > 0);
  browser.bookmarks.getTree = (...args) => { treeReads++; return getTree(...args); };
  assert.deepEqual(toasts(), ['Could not reload: Tree unavailable']);
  assert.equal(document.querySelector('#toasts .toast').className, 'toast error');
});

test('removing a folder offers undo, and undo offers redo', async () => {
  await visit('empty-folders');
  main().querySelector('input[data-sel="e1"]').click();
  buttonNamed(main(), 'Remove selected').click();
  await settle();
  document.querySelector('dialog.confirm button[value=ok]').click();
  await waitFor(() => toasts().length > 0);
  assert.deepEqual(toasts(), ['Removed 1 folder(s).']);
  assert.equal(main().querySelector('input[data-sel="e1"]'), null);
  assert.equal(navLink('empty-folders').querySelector('.badge').textContent, '1');

  toastButton('Removed').click();
  await waitFor(() => toasts().length > 0);
  assert.deepEqual(toasts(), ['Undone: Removed 1 empty folder(s)']);
  assert.equal(document.querySelector('#toasts .toast').className, 'toast info');
  assert.ok(main().querySelector('[data-sel]'));
  assert.equal(navLink('empty-folders').querySelector('.badge').textContent, '2');

  await visit('history');
  await settle(5);
  const staleRedo = buttonNamed(main(), 'Redo');
  assert.ok(staleRedo);

  toastButton('Undone').click();
  await waitFor(() => toasts().length > 0);
  assert.deepEqual(toasts(), ['Redone: Removed 1 empty folder(s)']);
  document.getElementById('toasts').replaceChildren();

  staleRedo.click();
  await waitFor(() => toasts().length > 0);
  assert.deepEqual(toasts(), ['Nothing to redo.']);
});

test('the undo offered after a redo undoes it again', async () => {
  await settle(5);
  buttonNamed(main(), 'Undo').click();
  await waitFor(() => toasts().length > 0);
  toastButton('Undone').click();
  await waitFor(() => toastButton('Redone'));
  toastButton('Redone').click();
  await waitFor(() => toastButton('Undone'));
  assert.deepEqual(toasts(), ['Undone: Removed 1 empty folder(s)']);
  toastButton('Undone').click();
  await waitFor(() => toastButton('Redone'));
  document.getElementById('toasts').replaceChildren();
});

test('undo with nothing left to undo says so', async () => {
  await settle(5);
  const staleUndo = buttonNamed(main(), 'Undo');
  assert.ok(staleUndo);
  staleUndo.click();
  await waitFor(() => toasts().length > 0);
  assert.match(toasts()[0], /^Undone: /);
  document.getElementById('toasts').replaceChildren();
  staleUndo.click();
  await waitFor(() => toasts().length > 0);
  assert.deepEqual(toasts(), ['Nothing to undo.']);
});

test('a change that fails is reported and the page still reloads', async (t) => {
  t.mock.method(console, 'error', () => {});
  await visit('empty-folders');
  const removeTree = browser.bookmarks.removeTree;
  browser.bookmarks.removeTree = async () => { throw new Error('Locked folder'); };
  const before = treeReads;
  main().querySelector('input[data-sel]').click();
  buttonNamed(main(), 'Remove selected').click();
  await settle();
  document.querySelector('dialog.confirm button[value=ok]').click();
  await waitFor(() => toasts().length > 0);
  browser.bookmarks.removeTree = removeTree;
  assert.deepEqual(toasts(), ['Something went wrong: Locked folder']);
  assert.equal(treeReads, before + 1);
  assert.equal(document.body.classList.contains('busy'), false);
});

test('a failure that is not an Error object is still reported in words', async (t) => {
  t.mock.method(console, 'error', () => {});
  const removeTree = browser.bookmarks.removeTree;
  browser.bookmarks.removeTree = async () => { throw 'plain text failure'; };
  tickOnly(main().querySelector('input[data-sel]'));
  buttonNamed(main(), 'Remove selected').click();
  await settle();
  document.querySelector('dialog.confirm button[value=ok]').click();
  await waitFor(() => toasts().length > 0);
  browser.bookmarks.removeTree = removeTree;
  assert.deepEqual(toasts(), ['Something went wrong: plain text failure']);

  document.getElementById('toasts').replaceChildren();
  browser.bookmarks.getTree = async () => { throw 'tree text failure'; };
  document.querySelector('[data-action=reload]').click();
  await waitFor(() => toasts().length > 0);
  browser.bookmarks.getTree = (...args) => { treeReads++; return getTree(...args); };
  assert.deepEqual(toasts(), ['Could not reload: tree text failure']);
});

test('a focus-dashboard message opens the asked-for page and brings this tab to the front', async () => {
  const [reply] = browser.runtime.onMessage.emit({ type: 'focus-dashboard', view: 'broken' });
  assert.equal(await reply, true);
  await settle(5);
  assert.equal(main().dataset.view, 'broken');
  assert.deepEqual(browser.calls.slice(-3).map(([name, ...args]) => [name, ...args]), [
    ['tabs.getCurrent'],
    ['tabs.update', 7, { active: true }],
    ['windows.update', 3, { focused: true }],
  ]);
});

test('a page can ask to be drawn again, as Organize does when discarding unsaved changes', async () => {
  await visit('organize');
  const autoApply = () => main().querySelector('.check-line input[type=checkbox]');
  autoApply().click();
  assert.equal(autoApply().checked, true);
  const before = treeReads;
  buttonNamed(main(), 'Discard changes').click();
  assert.equal(autoApply().checked, false);
  assert.equal(treeReads, before);
});

test('other messages are left for someone else to answer', () => {
  assert.deepEqual(browser.runtime.onMessage.emit({ type: 'something-else' }), [undefined]);
  assert.deepEqual(browser.runtime.onMessage.emit(undefined), [undefined]);
});

// Lets promise callbacks run while setTimeout is mocked.
async function flush() {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
}
const badge = (id) => Number(navLink(id).querySelector('.badge').textContent);

test('changes made elsewhere are picked up once a burst of them has settled', async (t) => {
  await settle(600);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const before = treeReads;
  const empty = badge('empty-folders');
  await browser.bookmarks.create({ parentId: 'toolbar_____', title: 'New empty' });
  t.mock.timers.tick(300);
  await browser.bookmarks.create({ parentId: 'toolbar_____', title: 'Another' });
  t.mock.timers.tick(499);
  await flush();
  assert.equal(treeReads, before);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(treeReads, before + 1);
  assert.equal(badge('empty-folders'), empty + 2);
});

test('a refresh keeps ticked boxes still on screen and drops the ones that went away', async (t) => {
  await visit('empty-folders');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const boxes = main().querySelectorAll('input[data-sel]');
  const [kept, gone] = [boxes[0].dataset.sel, boxes[1].dataset.sel];
  tickOnly(boxes[0], boxes[1]);
  assert.equal(main().querySelector('.count').textContent, '2 selected');

  await browser.bookmarks.update('a', { title: 'Alpha renamed' });
  t.mock.timers.tick(500);
  await flush();
  assert.equal(main().querySelector(`input[data-sel="${kept}"]`).checked, true);
  assert.equal(main().querySelector('.count').textContent, '2 selected');

  await browser.bookmarks.removeTree(gone);
  t.mock.timers.tick(500);
  await flush();
  assert.equal(main().querySelector(`input[data-sel="${gone}"]`), null);
  assert.equal(main().querySelector(`input[data-sel="${kept}"]`).checked, true);
  assert.equal(main().querySelector('.count').textContent, '1 selected');

  main().querySelector(`input[data-sel="${kept}"]`).focus();
  await browser.bookmarks.move('a', { parentId: 'toolbar_____' });
  t.mock.timers.tick(500);
  await flush();
  assert.equal(main().querySelector('.count').textContent, '1 selected');
});

test('only settings and ignore-list changes in local storage refresh the page', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const before = treeReads;
  await browser.storage.local.set({ unrelated: 1 });
  await browser.storage.sync.set({ settings: {} });
  t.mock.timers.tick(500);
  await flush();
  assert.equal(treeReads, before);

  await browser.storage.local.set({ settings: { dupesFolderName: 'Copies' } });
  t.mock.timers.tick(500);
  await flush();
  assert.equal(treeReads, before + 1);

  await browser.storage.local.set({ whitelist: {} });
  t.mock.timers.tick(500);
  await flush();
  assert.equal(treeReads, before + 2);
});

test('a refresh waits while the user types in a field and runs once they leave it', async (t) => {
  await visit('all');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const before = treeReads;
  const search = main().querySelector('input[type=search]');
  search.focus();
  search.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  t.mock.timers.tick(100);
  await flush();
  assert.equal(treeReads, before);

  await browser.bookmarks.create({ parentId: 'toolbar_____', title: 'While typing', url: 'https://typing.test/' });
  t.mock.timers.tick(500);
  await flush();
  assert.equal(treeReads, before);
  assert.equal(search.isConnected, true);

  search.blur();
  t.mock.timers.tick(100);
  await flush();
  assert.equal(treeReads, before + 1);
  assert.equal(search.isConnected, false);
});

test('a refresh waits while a dialog is open and runs once it closes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const before = treeReads;
  const answer = confirmDialog('Hold on?');
  await browser.bookmarks.create({ parentId: 'toolbar_____', title: 'Under a dialog' });
  t.mock.timers.tick(500);
  await flush();
  assert.equal(treeReads, before);

  document.querySelector('dialog.confirm button[value=cancel]').click();
  assert.equal(await answer, false);
  t.mock.timers.tick(100);
  await flush();
  assert.equal(treeReads, before + 1);
});

test('a refresh that comes during a change waits until the change is done', async (t) => {
  await visit('empty-folders');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release;
  const removeTree = browser.bookmarks.removeTree;
  browser.bookmarks.removeTree = async (id) => { await new Promise((resolve) => { release = resolve; }); return removeTree(id); };
  tickOnly(main().querySelector('input[data-sel]'));
  buttonNamed(main(), 'Remove selected').click();
  await flush();
  document.querySelector('dialog.confirm button[value=ok]').click();
  await flush();
  assert.equal(document.body.classList.contains('busy'), true);

  const before = treeReads;
  await browser.bookmarks.create({ parentId: 'toolbar_____', title: 'During a change', url: 'https://during.test/' });
  t.mock.timers.tick(500);
  await flush();
  assert.equal(treeReads, before);

  release();
  await flush();
  browser.bookmarks.removeTree = removeTree;
  assert.equal(document.body.classList.contains('busy'), false);
  assert.equal(treeReads, before + 1);
  assert.deepEqual(toasts(), ['Removed 1 folder(s).']);

  t.mock.timers.tick(500);
  await flush();
  assert.equal(treeReads, before + 2);
});
