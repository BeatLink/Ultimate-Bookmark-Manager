// Dashboard shell shared by the full-page tab and the sidebar: loads data, routes between views and runs actions.

import { h, toast } from './dom.js';
import { flatten } from '../lib/tree.js';
import { Actions } from '../lib/actions.js';
import { loadSettings, loadWhitelist, loadLinkResults } from '../lib/settings.js';
import { LinkChecker } from './link-checker.js';
import duplicates from './views/duplicates.js';
import emptyFolders from './views/empty-folders.js';
import sameName from './views/same-name.js';
import untitled from './views/untitled.js';
import broken from './views/broken.js';
import redirects from './views/redirects.js';
import organize from './views/organize.js';
import all from './views/all.js';
import history from './views/history.js';
import settings from './views/settings.js';

const VIEWS = [duplicates, emptyFolders, sameName, untitled, broken, redirects, organize, all, history, settings];
const isSidebar = new URLSearchParams(location.search).has('sidebar');
document.body.classList.toggle('sidebar', isSidebar);

const state = { root: null, flat: [], settings: null, whitelist: {}, linkResults: null, stale: false };
let current = VIEWS[0];
let busy = 0;
let quietUntil = 0;
let cache = new Map();

const ctx = {
  state,
  actions: new Actions(),
  isSidebar,
  ignoredIds: () => new Set(Object.keys(state.whitelist)),

  // Caches a computed result until the next reload, so badges and views share one scan.
  memo(key, fn) {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  },
  linkChecker: null,

  // Runs a change with the page marked busy, reports failures, then reloads and re-renders.
  async run(fn, { rerender = true } = {}) {
    busy++;
    document.body.classList.add('busy');
    try {
      const result = await fn();
      return result;
    } catch (err) {
      console.error(err);
      toast(`Something went wrong: ${err.message ?? err}`, 'error');
    } finally {
      busy--;
      quietUntil = Date.now() + 1500;
      document.body.classList.toggle('busy', busy > 0);
      await load();
      if (rerender) render();
    }
  },

  // Tells the user an action happened and offers to undo it straight away.
  done(message) {
    toast(message, 'success', { label: 'Undo', run: () => ctx.run(async () => {
      const entry = await ctx.actions.undoLatest();
      if (entry) toast(`Undone: ${entry.label}`);
    }) });
  },

  go(id) {
    location.hash = id;
  },

  render: () => render(),
};

async function load() {
  const [[root], settingsValue, whitelist, linkResults] = await Promise.all([
    browser.bookmarks.getTree(), loadSettings(), loadWhitelist(), loadLinkResults(),
  ]);
  cache = new Map();
  Object.assign(state, { root, flat: flatten(root), settings: settingsValue, whitelist, linkResults, stale: false });
  ctx.actions.limit = settingsValue.historyLimit;
  document.getElementById('stale').hidden = true;
}

function renderNav() {
  const nav = document.getElementById('nav');
  nav.replaceChildren(...VIEWS.map((v) => h('a', {
    href: `#${v.id}`, class: v === current ? 'active' : '', 'aria-current': v === current ? 'page' : null,
  }, h('span', { text: v.label }), v.badge && h('span', { class: 'badge', text: v.badge(ctx) || '' }))));

  const picker = document.getElementById('nav-select');
  picker.replaceChildren(...VIEWS.map((v) => h('option', { value: v.id, text: v.label, selected: v === current })));
}

function render() {
  const main = document.getElementById('main');
  const scroll = window.scrollY;
  const sameView = main.dataset.view === current.id;
  main.dataset.view = current.id;
  main.replaceChildren(current.render(ctx));
  window.scrollTo(0, sameView ? scroll : 0);
  renderNav();
  document.title = `${current.label} — Bookmark Manager`;
}

function route() {
  const id = location.hash.slice(1);
  current = VIEWS.find((v) => v.id === id) ?? VIEWS[0];
  render();
}

// Changes made elsewhere mark the results stale instead of re-rendering under the user's selection.
function onBookmarksChanged() {
  if (busy || Date.now() < quietUntil) return;
  state.stale = true;
  document.getElementById('stale').hidden = false;
}

async function start() {
  await load();
  ctx.linkChecker = new LinkChecker(ctx);
  document.getElementById('nav-select').addEventListener('change', (e) => ctx.go(e.target.value));
  document.getElementById('stale-refresh').addEventListener('click', () => ctx.run(async () => {}));
  document.getElementById('open-tab').addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL(`src/ui/app.html#${current.id}`) });
  });
  window.addEventListener('hashchange', route);
  for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved']) browser.bookmarks[ev].addListener(onBookmarksChanged);

  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'focus-dashboard' || isSidebar) return undefined;
    ctx.go(msg.view);
    return browser.tabs.getCurrent().then(async (tab) => {
      await browser.tabs.update(tab.id, { active: true });
      await browser.windows.update(tab.windowId, { focused: true });
      return true;
    });
  });

  route();
}

start().catch((err) => {
  console.error(err);
  document.getElementById('main').replaceChildren(h('p', { class: 'error', text: `Failed to load bookmarks: ${err.message}` }));
});
