// Drives the dashboard's "All bookmarks" page through its DOM, as a person with a mouse and keyboard would.

import { installBrowser, settle } from './browser-env.js';

// Loads the dashboard on the All bookmarks page with the given bookmark tree and saved page storage.
export async function startAll(tree, { saved = {}, ...options } = {}) {
  const browser = installBrowser({ page: 'app.html', tree, ...options });
  for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, JSON.stringify(value));
  location.hash = 'all';
  await import('../src/ui/app.js');
  await settle(20);
  return browser;
}

// Waits for a change, its reload and the re-render that follows.
export const idle = (ms = 30) => settle(ms);

export const list = () => document.querySelector('.bm-tree');
export const rows = () => [...list().querySelectorAll('.tree-row')];
export const rowIds = () => rows().map((r) => r.dataset.id);
export const rowEl = (id) => list().querySelector(`[data-id="${id}"]`);
export const selectedIds = () => rows().filter((r) => r.classList.contains('selected')).map((r) => r.dataset.id);
export const focusedId = () => document.activeElement?.dataset?.id;
export const statusText = () => document.querySelector('.tree-status').textContent;
export const headLabels = () => [...document.querySelectorAll('.bm-tree-head > *')].map((el) => el.textContent);
export const searchBox = () => document.querySelector('input[type=search]');
export const filterBox = () => document.querySelector('select[aria-label=Show]');
export const toolbarButton = (text) => [...document.querySelectorAll('.tree-toolbar button')].find((b) => b.textContent === text);
export const toasts = () => [...document.querySelectorAll('#toasts .toast')].map((t) => t.firstChild.textContent);
export const lastToast = () => toasts().at(-1);
export const label = (id) => rowEl(id).querySelector('.cell.name').textContent;
export const cell = (id, key) => rowEl(id).querySelector(`.cell.${key}`)?.textContent;

// Fires an event with extra properties such as keys held, the pointer position or a dataTransfer.
export function fire(el, type, props = {}, Kind = Event) {
  const e = new Kind(type, { bubbles: true, cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  el.dispatchEvent(e);
  return e;
}

export const mousedown = (el, props = {}) => fire(el, 'mousedown', { button: 0, ...props }, MouseEvent);
export const click = (el, props = {}) => fire(el, 'click', { button: 0, ...props }, MouseEvent);
export const press = (key, props = {}, el = document.activeElement?.closest?.('.tree-row') ?? list()) => fire(el, 'keydown', { key, ...props }, KeyboardEvent);

// Selects a row the way a plain click does.
export function pick(id, props = {}) {
  mousedown(rowEl(id), props);
  click(rowEl(id), props);
}

// Opens the right-click menu on a row, or on the empty list when no id is given.
export function rightClick(id) {
  fire(id ? rowEl(id) : list(), 'contextmenu', { clientX: 10, clientY: 10 }, MouseEvent);
}

const menu = () => document.querySelector('dialog.menu');
// The open menu's items as "label" or "label (off)" when disabled.
export const menuItems = () => [...menu().querySelectorAll('button')].map((b) => b.firstChild.textContent + (b.disabled ? ' (off)' : ''));
export const menuOpen = () => Boolean(menu());
export function choose(text) {
  const button = [...menu().querySelectorAll('button')].find((b) => b.firstChild.textContent === text);
  if (!button) throw new Error(`No menu item ${text}; have ${menuItems().join(', ')}`);
  button.click();
}
export const closeMenu = () => menu()?.close();

// The open modal dialog other than a menu.
export const dialog = () => document.querySelector('dialog.confirm[open]');
export const dialogText = () => dialog().querySelector('p, h2').textContent;
// Answers the open dialog: fills its text boxes in order, then presses OK or Cancel.
export function answer(ok = true, values = []) {
  const d = dialog();
  if (!d) throw new Error('No dialog is open');
  d.querySelectorAll('input').forEach((input, i) => { if (values[i] !== undefined) input.value = values[i]; });
  const button = ok ? d.querySelector('button[value=ok]') : [...d.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
  button.click();
}

// A stand-in for the dataTransfer of a drag.
export function transfer(data = {}) {
  const store = { ...data };
  return {
    store,
    get types() { return Object.keys(store); },
    setData(type, value) { store[type] = value; },
    getData(type) { return store[type] ?? ''; },
    effectAllowed: 'none',
    dropEffect: 'none',
  };
}

// Gives a row a real size so a drop can land above, inside or below it.
export function sized(el) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 });
  return el;
}

// Titles of a folder's children in the bookmark store.
export async function childTitles(id) {
  return (await browser.bookmarks.getChildren(id)).map((n) => n.title);
}

// Captures files the page saves through the download prompt, without the test page following the link.
export function captureDownloads() {
  const saved = [];
  URL.createObjectURL = (blob) => { saved.push(blob); return `blob:test/${saved.length}`; };
  document.addEventListener('click', (e) => { if (e.target.download) e.preventDefault(); }, true);
  return saved;
}
