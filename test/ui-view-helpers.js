// Drives the real dashboard in tests: opens it on a page, finds buttons by their text and answers dialogs.

import assert from 'node:assert/strict';
import { installBrowser, settle } from './browser-env.js';

// Loads the dashboard with a bookmark tree and stored data, showing the given page.
export async function openDashboard({ view = 'stats', tree, local = {}, granted } = {}) {
  const browser = installBrowser({ page: 'app.html', tree, granted });
  Object.assign(browser.storage.local.data, structuredClone(local));
  location.hash = view;
  await import('../src/ui/app.js');
  await settle(20);
  return browser;
}

export const main = () => document.getElementById('main');

// The text of every toast on screen, and a way to clear them between steps.
export const toasts = () => document.getElementById('toasts').textContent;
export const clearToasts = () => document.getElementById('toasts').replaceChildren();

// The button whose text is exactly `label`, or undefined.
export function findButton(label, root = main()) {
  return [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
}

// Clicks the button with this text and lets the work it starts finish.
export async function click(label, root = main()) {
  const button = findButton(label, root);
  assert.ok(button, `no button “${label}”`);
  assert.equal(button.disabled, false, `button “${label}” is disabled`);
  button.click();
  await settle(15);
}

// The open dialog's message, then confirms or cancels it.
export async function answer(confirm) {
  const dialog = document.querySelector('dialog[open]');
  assert.ok(dialog, 'no dialog is open');
  const message = dialog.querySelector('p')?.textContent ?? '';
  dialog.querySelector(`button[value=${confirm ? 'ok' : 'cancel'}]`).click();
  await settle(15);
  return message;
}

// Ticks or unticks a row's checkbox.
export function tick(id, on = true) {
  const box = main().querySelector(`input[data-sel="${id}"]`);
  assert.ok(box, `no checkbox for ${id}`);
  box.checked = on;
  box.dispatchEvent(new Event('change', { bubbles: true }));
}

// The selection bar's "N selected" text.
export const selectedCount = () => main().querySelector('.selection-bar .count').textContent;

// Shows another page of the dashboard.
export async function show(view) {
  location.hash = view;
  await settle(10);
}

// Presses the reload button, which re-reads bookmarks and storage and re-renders.
export async function reload() {
  document.querySelector('[data-action=reload]').click();
  await settle(20);
}

// Every bookmark id currently in the fake store.
export async function ids(browser) {
  const out = [];
  const walk = (n) => { out.push(n.id); (n.children ?? []).forEach(walk); };
  walk((await browser.bookmarks.getTree())[0]);
  return out;
}

// Catches files the page offers to download, as { name, blob }, without leaving the page.
export function catchDownloads() {
  const files = [];
  const blobs = new Map();
  URL.createObjectURL = (blob) => { const url = `blob:test/${blobs.size}`; blobs.set(url, blob); return url; };
  URL.revokeObjectURL = () => {};
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[download]');
    if (!a) return;
    e.preventDefault();
    files.push({ name: a.getAttribute('download'), blob: blobs.get(a.getAttribute('href')) });
  }, true);
  return files;
}
