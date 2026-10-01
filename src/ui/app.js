// Dashboard shell shared by the full-page tab and the sidebar: loads data, routes between views and runs actions.

import { h, toast, Selection } from './dom.js';
import { flatten, bookmarksOnly } from '../lib/tree.js';
import { Actions } from '../lib/actions.js';
import { loadSettings, loadWhitelist, loadLinkResults } from '../lib/settings.js';
import { LinkChecker } from './link-checker.js';
import stats from './views/stats.js';
import duplicates from './views/duplicates.js';
import emptyFolders from './views/empty-folders.js';
import sameName from './views/same-name.js';
import untitled from './views/untitled.js';
import broken from './views/broken.js';
import redirects from './views/redirects.js';
import organize from './views/organize.js';
import all from './views/all/index.js';
import history from './views/history.js';
import settings from './views/settings.js';
import help from './views/help.js';

const VIEWS = [stats, duplicates, emptyFolders, sameName, untitled, broken, redirects, organize, all, history, settings, help];
// Changes made elsewhere are picked up once a burst of them has settled.
const REFRESH_DELAY_MS = 500;
const isSidebar = new URLSearchParams(location.search).has('sidebar');
document.body.classList.toggle('sidebar', isSidebar);

const state = { root: null, flat: [], settings: null, whitelist: {}, linkResults: null };
let current = VIEWS[0];
let busy = 0;
let refreshTimer;
let refreshWaiting = false;
const selections = new Map();
let cache = new Map();

const ctx = {
  state,
  actions: new Actions(),
  isSidebar,
  ignoredIds: () => new Set(Object.keys(state.whitelist)),

  // A view's selection, kept across re-renders so a refresh does not untick anything still on screen.
  selection(key, ids) {
    if (!selections.has(key)) selections.set(key, new Selection());
    const sel = selections.get(key);
    sel.resetListeners();
    sel.retain(ids);
    return sel;
  },

  // Caches a computed result until the next reload, so badges and views share one scan.
  memo(key, fn) {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  },
  linkChecker: null,

  // Runs a change with the page marked busy, reports failures, then reloads and re-renders.
  async run(fn) {
    busy++;
    document.body.classList.add('busy');
    try {
      return await fn();
    } catch (err) {
      console.error(err);
      toast(`Something went wrong: ${err.message ?? err}`, 'error');
    } finally {
      busy--;
      document.body.classList.toggle('busy', busy > 0);
      await load();
      render();
    }
  },

  // Reads the bookmarks and settings again and redraws the page.
  reload() {
    return ctx.run(async () => {});
  },

  // Tells the user an action happened and offers to undo it straight away.
  done(message) {
    toast(message, 'success', { label: 'Undo', run: () => ctx.undo() });
  },

  // Undoes the latest change, offering to redo it.
  undo() {
    return ctx.run(async () => {
      const entry = await ctx.actions.undoLatest();
      if (entry) toast(`Undone: ${entry.label}`, 'info', { label: 'Redo', run: () => ctx.redo() });
      else toast('Nothing to undo.');
    });
  },

  // Applies the latest undone change again, offering to undo it.
  redo() {
    return ctx.run(async () => {
      const entry = await ctx.actions.redoLatest();
      if (entry) toast(`Redone: ${entry.label}`, 'success', { label: 'Undo', run: () => ctx.undo() });
      else toast('Nothing to redo.');
    });
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
  Object.assign(state, { root, flat: flatten(root), settings: settingsValue, whitelist, linkResults });
  Object.assign(ctx.actions, { limit: settingsValue.historyLimit, days: settingsValue.historyDays });
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
  document.title = `${current.label} — Ultimate Bookmark Manager`;
}

// "#organize" shows a page; "#help:organize" shows the Help page at that page's section.
function route() {
  const [id, section = ''] = location.hash.slice(1).split(':');
  current = VIEWS.find((v) => v.id === id) ?? VIEWS[0];
  ctx.section = section;
  render();
}

// True while the user is typing in a field or answering a dialog, when a re-render would get in their way.
function isEditing() {
  if (document.querySelector('dialog[open]')) return true;
  const el = document.activeElement;
  return Boolean(el?.closest?.('#main') && el.matches('textarea, select, input:not([type=checkbox]):not([type=radio]), [contenteditable]'));
}

function scheduleRefresh(delay = REFRESH_DELAY_MS) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, delay);
}

async function refresh() {
  if (busy) return scheduleRefresh();
  if (isEditing()) {
    refreshWaiting = true;
    return;
  }
  refreshWaiting = false;
  await load();
  render();
}

async function start() {
  await load();
  ctx.linkChecker = new LinkChecker(ctx);
  document.getElementById('nav-select').addEventListener('change', (e) => ctx.go(e.target.value));
  for (const button of document.querySelectorAll('[data-action=reload]')) {
    button.addEventListener('click', () => {
      clearTimeout(refreshTimer);
      refreshWaiting = false;
      ctx.reload()
        .then(() => toast(`Reloaded ${bookmarksOnly(state.flat).length} bookmarks.`, 'success'))
        .catch((err) => toast(`Could not reload: ${err.message ?? err}`, 'error'));
    });
  }
  document.getElementById('open-tab').addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL(`src/ui/app.html#${current.id}`) });
  });
  window.addEventListener('hashchange', route);
  for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved']) browser.bookmarks[ev].addListener(() => scheduleRefresh());
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('settings' in changes || 'whitelist' in changes)) scheduleRefresh();
  });
  // A refresh held back while the user was editing runs once they leave the field or close the dialog.
  document.addEventListener('focusout', () => refreshWaiting && scheduleRefresh(100));
  document.addEventListener('close', () => refreshWaiting && scheduleRefresh(100), true);

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
