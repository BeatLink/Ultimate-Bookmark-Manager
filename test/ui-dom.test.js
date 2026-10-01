import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, settle, uninstallDom } from './browser-env.js';

installBrowser({ page: 'app.html' });
const { h, formatDate, toast, confirmDialog, promptDialog, fieldsDialog, showMenu, Selection, downloadFile } = await import('../src/ui/dom.js');

after(uninstallDom);

// Resolves to the promise's value, or 'pending' when it has not settled within a moment.
const outcome = (promise) => Promise.race([promise, settle(30).then(() => 'pending')]);

test('h builds an element with class, text, attributes, properties, listeners and children', () => {
  let clicks = 0;
  const el = h('button', { class: 'primary', text: 'Go', title: 'Tip', disabled: true, hidden: false, skip: null, gone: undefined, onclick: () => clicks++ });
  assert.equal(el.tagName, 'BUTTON');
  assert.equal(el.className, 'primary');
  assert.equal(el.textContent, 'Go');
  assert.equal(el.getAttribute('title'), 'Tip');
  assert.equal(el.disabled, true);
  assert.equal(el.hasAttribute('hidden'), false);
  assert.equal(el.hasAttribute('skip'), false);
  el.disabled = false;
  el.click();
  assert.equal(clicks, 1);
});

test('h sets boolean attributes it has no property for as empty attributes', () => {
  const el = h('div', { 'data-flag': true, 'aria-label': 'Label' });
  assert.equal(el.getAttribute('data-flag'), '');
  assert.equal(el.getAttribute('aria-label'), 'Label');
});

test('h flattens nested children, turns values into text and skips empty ones', () => {
  const el = h('p', null, 'a', [h('b', { text: 'b' }), [3, null, undefined, false]], 0);
  assert.equal(el.textContent, 'ab30');
  assert.equal(el.querySelector('b').textContent, 'b');
});

test('formatDate shows a readable date and nothing for a missing one', () => {
  assert.equal(formatDate(0), '');
  assert.equal(formatDate(undefined), '');
  const text = formatDate(Date.UTC(2024, 5, 15, 12));
  assert.match(text, /2024/);
  assert.match(text, /15/);
});

test('a toast shows its message, offers its action, which closes it', () => {
  let ran = 0;
  toast('Saved.', 'success', { label: 'Undo', run: () => ran++ });
  const el = document.querySelector('#toasts .toast.success');
  assert.equal(el.getAttribute('role'), 'status');
  assert.match(el.textContent, /Saved\./);
  el.querySelector('button').click();
  assert.equal(ran, 1);
  assert.equal(el.isConnected, false);
});

test('an error toast is announced as an alert, and a plain toast defaults to info', () => {
  toast('Broke.', 'error');
  toast('Hello.');
  assert.equal(document.querySelector('#toasts .toast.error').getAttribute('role'), 'alert');
  const info = document.querySelector('#toasts .toast.info');
  assert.equal(info.textContent, 'Hello.');
  assert.equal(info.querySelector('button'), null);
});

test('a toast removes itself when its time runs out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  toast('Short-lived.');
  toast('Bad news.', 'error');
  const [short, bad] = [...document.querySelectorAll('#toasts .toast')].slice(-2);
  t.mock.timers.tick(6000);
  assert.equal(short.isConnected, false);
  assert.equal(bad.isConnected, true);
  t.mock.timers.tick(4000);
  assert.equal(bad.isConnected, false);
});

test('a confirm dialog resolves true when confirmed and removes itself', async () => {
  const answer = confirmDialog('Delete these?', 'Delete');
  const dialog = document.querySelector('dialog.confirm');
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('p').textContent, 'Delete these?');
  const ok = dialog.querySelector('button[value=ok]');
  assert.equal(ok.textContent, 'Delete');
  assert.equal(ok.className, 'danger');
  ok.click();
  assert.equal(await outcome(answer), true);
  assert.equal(dialog.isConnected, false);
});

test('a confirm dialog resolves false when cancelled, and a safe one uses a primary button', async () => {
  const answer = confirmDialog('Go on?', 'Continue', false);
  const dialog = document.querySelector('dialog.confirm');
  assert.equal(dialog.querySelector('button[value=ok]').className, 'primary');
  dialog.querySelector('button[value=cancel]').click();
  assert.equal(await outcome(answer), false);
});

test('a prompt dialog resolves to the trimmed text', async () => {
  const answer = promptDialog('Folder name', 'Create', '  Work  ');
  const dialog = document.querySelector('dialog.prompt');
  assert.equal(dialog.querySelector('span').textContent, 'Folder name');
  assert.equal(dialog.querySelector('input').value, '  Work  ');
  dialog.querySelector('button[value=ok]').click();
  assert.equal(await outcome(answer), 'Work');
  assert.equal(dialog.isConnected, false);
});

test('a prompt dialog resolves to null when left blank or cancelled', async () => {
  const blank = promptDialog('Name');
  document.querySelector('dialog.prompt input').value = '   ';
  document.querySelector('dialog.prompt button[value=ok]').click();
  assert.equal(await outcome(blank), null);

  const cancelled = promptDialog('Name', 'OK', 'kept');
  [...document.querySelectorAll('dialog.prompt button')].find((b) => b.textContent === 'Cancel').click();
  assert.equal(await outcome(cancelled), null);
});

test('a fields dialog keeps itself open with the first validation error, then resolves every field trimmed', async () => {
  const answer = fieldsDialog('New rule', [
    { name: 'title', label: 'Title', value: 'x', validate: (v) => (v.length < 2 ? 'Too short' : null) },
    { name: 'url', label: 'URL', placeholder: 'https://', spellcheck: false },
  ], 'Add');
  const dialog = document.querySelector('dialog.prompt');
  assert.equal(dialog.querySelector('h2').textContent, 'New rule');
  const [title, url] = dialog.querySelectorAll('input');
  assert.equal(url.getAttribute('placeholder'), 'https://');
  const error = dialog.querySelector('.error');
  assert.equal(error.hidden, true);

  dialog.querySelector('button[value=ok]').click();
  assert.equal(await outcome(answer), 'pending');
  assert.equal(dialog.open, true);
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, 'Too short');
  assert.equal(document.activeElement, title);

  title.value = ' Long enough ';
  url.value = ' https://a.test/ ';
  dialog.querySelector('button[value=ok]').click();
  assert.deepEqual(await outcome(answer), { title: 'Long enough', url: 'https://a.test/' });
  assert.equal(dialog.isConnected, false);
});

test('a fields dialog resolves to null when cancelled, without validating', async () => {
  let validated = 0;
  const answer = fieldsDialog('Edit', [{ name: 'a', label: 'A', validate: () => { validated++; return 'never'; } }]);
  [...document.querySelectorAll('dialog.prompt button')].find((b) => b.textContent === 'Cancel').click();
  assert.equal(await outcome(answer), null);
  assert.equal(validated, 0);
});

test('a fields dialog ignores a submit that did not come from its confirm button', async () => {
  const answer = fieldsDialog('Edit', [{ name: 'a', label: 'A', validate: () => 'blocked' }]);
  const dialog = document.querySelector('dialog.prompt');
  dialog.querySelector('form').requestSubmit();
  assert.equal(await outcome(answer), null);
  assert.equal(dialog.querySelector('.error').hidden, true);
});

test('a selection tracks ids and tells its listeners about each change', () => {
  const sel = new Selection();
  const seen = [];
  sel.onChange((s) => seen.push(s.ids));
  sel.set(['a', 'b', 'c'], true);
  assert.equal(sel.size, 3);
  assert.ok(sel.has('b'));
  sel.set(['b'], false);
  assert.deepEqual(sel.ids, ['a', 'c']);
  sel.retain(['c', 'z']);
  assert.deepEqual(sel.ids, ['c']);
  sel.clear();
  assert.equal(sel.size, 0);
  assert.deepEqual(seen, [['a', 'b', 'c'], ['a', 'c'], []]);
});

test('a selection forgets its listeners when reset', () => {
  const sel = new Selection();
  let calls = 0;
  sel.onChange(() => calls++);
  sel.resetListeners();
  sel.set(['a'], true);
  assert.equal(calls, 0);
  assert.ok(sel.has('a'));
});

test('downloadFile clicks a temporary download link and frees the file later', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const made = [];
  const freed = [];
  t.mock.method(URL, 'createObjectURL', (blob) => { made.push(blob); return 'blob:test/1'; });
  t.mock.method(URL, 'revokeObjectURL', (url) => freed.push(url));
  const clicked = [];
  const listener = (e) => { clicked.push(e.target.getAttribute('download')); e.preventDefault(); };
  document.addEventListener('click', listener);
  downloadFile('hello', 'notes.txt', 'text/plain');
  document.removeEventListener('click', listener);
  assert.deepEqual(clicked, ['notes.txt']);
  assert.equal(made[0].type, 'text/plain');
  assert.equal(document.querySelector('a[download]'), null);
  t.mock.timers.tick(10000);
  assert.deepEqual(freed, ['blob:test/1']);
});

test('downloadFile saves JSON by default', (t) => {
  let type;
  t.mock.method(URL, 'createObjectURL', (blob) => { type = blob.type; return 'blob:test/2'; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  downloadFile('{}', 'data.json');
  assert.equal(type, 'application/json');
});

test('a menu lists its items, skips empty ones and stray dividers, and runs the chosen item after closing', () => {
  const ran = [];
  let closed = 0;
  showMenu(20, 30, [
    '-', null,
    { label: 'Open', key: 'Enter', run: () => ran.push(['open', document.querySelector('dialog.menu')]) },
    '-', '-',
    { label: 'Pinned', checked: true, run: () => {} },
    { label: 'Locked', disabled: true, run: () => ran.push('locked') },
    false,
    '-',
  ], () => closed++);
  const dialog = document.querySelector('dialog.menu');
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelectorAll('hr').length, 1);
  const buttons = [...dialog.querySelectorAll('button')];
  assert.deepEqual(buttons.map((b) => b.textContent), ['OpenEnter', 'Pinned', 'Locked']);
  assert.equal(buttons[0].getAttribute('role'), 'menuitem');
  assert.equal(buttons[0].querySelector('.menu-key').textContent, 'Enter');
  assert.equal(buttons[1].getAttribute('role'), 'menuitemcheckbox');
  assert.equal(buttons[1].getAttribute('aria-checked'), 'true');
  assert.equal(buttons[2].disabled, true);
  assert.equal(document.activeElement, buttons[0]);
  assert.equal(dialog.style.left, '20px');
  assert.equal(dialog.style.top, '30px');

  buttons[0].click();
  assert.deepEqual(ran, [['open', null]]);
  assert.equal(closed, 1);
  assert.equal(dialog.isConnected, false);
});

test('a menu moves focus with the arrow, Home and End keys, wrapping around and skipping disabled items', () => {
  showMenu(0, 0, [{ label: 'A', run() {} }, { label: 'B', disabled: true, run() {} }, { label: 'C', run() {} }, { label: 'D', run() {} }]);
  const dialog = document.querySelector('dialog.menu');
  const key = (k) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    dialog.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const focused = () => document.activeElement.textContent;
  assert.equal(focused(), 'A');
  assert.ok(key('ArrowDown'));
  assert.equal(focused(), 'C');
  key('End');
  assert.equal(focused(), 'D');
  key('ArrowDown');
  assert.equal(focused(), 'A');
  key('ArrowUp');
  assert.equal(focused(), 'D');
  key('Home');
  assert.equal(focused(), 'A');
  assert.equal(key('x'), false);
  dialog.close();
  assert.equal(dialog.isConnected, false);
});

test('a menu with nothing to choose ignores the arrow keys', () => {
  showMenu(0, 0, [{ label: 'Off', disabled: true, run() {} }]);
  const dialog = document.querySelector('dialog.menu');
  const e = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
  dialog.dispatchEvent(e);
  assert.equal(e.defaultPrevented, false);
  dialog.close();
});

test('a menu closes on a click outside it but not on one inside, and blocks the page context menu', () => {
  let closed = 0;
  showMenu(0, 0, [{ label: 'A', run() {} }], () => closed++);
  const dialog = document.querySelector('dialog.menu');
  const inside = new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true, cancelable: true });
  dialog.dispatchEvent(inside);
  assert.equal(inside.defaultPrevented, false);
  assert.equal(dialog.open, true);

  const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  dialog.dispatchEvent(menu);
  assert.equal(menu.defaultPrevented, true);

  const outside = new MouseEvent('mousedown', { clientX: 900, clientY: 700, bubbles: true, cancelable: true });
  dialog.dispatchEvent(outside);
  assert.equal(outside.defaultPrevented, true);
  assert.equal(closed, 1);
  assert.equal(dialog.isConnected, false);
});

test('a menu is kept inside the window', () => {
  showMenu(5000, -50, [{ label: 'A', run() {} }]);
  const dialog = document.querySelector('dialog.menu');
  assert.equal(dialog.style.left, `${innerWidth - 4}px`);
  assert.equal(dialog.style.top, '4px');
  dialog.close();
});
