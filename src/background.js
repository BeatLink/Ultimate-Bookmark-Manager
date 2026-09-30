// Entry points (toolbar button, keyboard shortcut, Tools menu, "bm" address-bar keyword) and automatic organizing.

import { loadSettings, loadWhitelist } from './lib/settings.js';
import { planMoves } from './lib/organize.js';
import { flatten } from './lib/tree.js';
import { Actions } from './lib/actions.js';
import { push, pull, reconcile, isSyncEnabled, guarded } from './lib/sync.js';

const VIEWS = {
  stats: 'Dashboard',
  duplicates: 'Duplicates',
  'empty-folders': 'Empty folders',
  'same-name': 'Same-name folders',
  untitled: 'Bookmarks without a useful name',
  broken: 'Broken links',
  redirects: 'Redirects',
  organize: 'Organize',
  all: 'All bookmarks',
  history: 'Undo history & backup',
  settings: 'Settings',
};

// Focuses an open dashboard tab if there is one, otherwise opens a new one.
async function openDashboard(view = 'stats') {
  const focused = await browser.runtime.sendMessage({ type: 'focus-dashboard', view }).catch(() => false);
  if (!focused) await browser.tabs.create({ url: browser.runtime.getURL(`src/ui/app.html#${view}`) });
}

browser.action.onClicked.addListener(() => openDashboard());

// Clears what the removed AI organizer left in storage: its settings, saved page summaries and restart marker.
async function removeAiLeftovers() {
  await browser.storage.local.remove(['aiSummaries', 'aiResume']);
  const { settings } = await browser.storage.local.get('settings');
  if (settings && 'ai' in settings) {
    delete settings.ai;
    await browser.storage.local.set({ settings });
  }
}
browser.runtime.onInstalled.addListener(() => removeAiLeftovers().catch((err) => console.error('Cleanup failed', err)));

browser.commands.onCommand.addListener((command) => {
  if (command === 'open-dashboard') openDashboard();
});

browser.runtime.onInstalled.addListener(() => {
  browser.menus.removeAll();
  browser.menus.create({ id: 'root', title: 'Bookmark Manager', contexts: ['tools_menu'] });
  for (const [id, title] of Object.entries(VIEWS)) {
    browser.menus.create({ id: `view:${id}`, parentId: 'root', title, contexts: ['tools_menu'] });
  }
});

browser.menus.onClicked.addListener((info) => {
  if (String(info.menuItemId).startsWith('view:')) openDashboard(info.menuItemId.slice(5));
});

browser.omnibox.setDefaultSuggestion({ description: 'Bookmark Manager — type a view: duplicates, broken, redirects, empty-folders, untitled…' });

browser.omnibox.onInputChanged.addListener((text, suggest) => {
  const q = text.trim().toLowerCase();
  suggest(
    Object.entries(VIEWS)
      .filter(([id, title]) => !q || id.includes(q) || title.toLowerCase().includes(q))
      .map(([id, title]) => ({ content: id, description: title })),
  );
});

browser.omnibox.onInputEntered.addListener((text) => {
  const q = text.trim().toLowerCase();
  const match = Object.keys(VIEWS).find((id) => id === q) ?? Object.keys(VIEWS).find((id) => id.startsWith(q));
  openDashboard(match ?? 'stats');
});

// New bookmarks wait this long before being organized, so a folder picked in the star panel wins.
const AUTO_DELAY_MS = 4000;
// More new bookmarks than this at once means an import, sync or "bookmark all tabs", which is left alone.
const BURST_LIMIT = 20;
const pending = new Map();
let autoTimer;

browser.bookmarks.onCreated.addListener((id, node) => {
  if (!node.url) return;
  pending.set(id, node.parentId);
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => autoOrganize().catch((err) => console.error('Auto-organize failed', err)), AUTO_DELAY_MS);
});

async function autoOrganize() {
  const batch = new Map(pending);
  pending.clear();
  if (batch.size > BURST_LIMIT) return;
  const settings = await loadSettings();
  if (!settings.organize.autoApply || !settings.organize.rules.length) return;

  // Bookmarks brought back by an undo appear in the history's id map and must not be moved again.
  const { history } = await browser.storage.local.get('history');
  const restored = new Set(Object.values(history?.idMap ?? {}));
  const [root] = await browser.bookmarks.getTree();
  const all = flatten(root);
  const fresh = all.filter((b) => batch.get(b.id) === b.parentId && !restored.has(b.id));
  const rootFolders = root.children.map((c) => ({ id: c.id, title: c.title }));
  const ignored = new Set(Object.keys(await loadWhitelist()));
  const { moves } = planMoves(fresh, settings.organize.rules, rootFolders, ignored, all);
  if (!moves.length) return;

  const label = moves.length === 1 ? `Auto-organized “${moves[0].bookmark.title || moves[0].bookmark.url}”` : `Auto-organized ${moves.length} new bookmarks`;
  await new Actions({ limit: settings.historyLimit }).organize(moves.map((m) => ({ id: m.bookmark.id, target: m.target })), label);
}

// Settings sync: local edits are uploaded and changes from other devices applied, each after a short pause.
const local = browser.storage.local;
const sync = browser.storage.sync;
const syncTimers = {};

function soon(name, step) {
  clearTimeout(syncTimers[name]);
  syncTimers[name] = setTimeout(async () => {
    if (await isSyncEnabled(local)) await guarded(local, step);
  }, 1000);
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ('settings' in changes || 'whitelist' in changes)) soon('push', () => push(local, sync));
  if (area === 'sync' && Object.keys(changes).some((k) => k.startsWith('cfg_'))) soon('pull', () => pull(local, sync));
});

browser.runtime.onStartup.addListener(() => soon('reconcile', () => reconcile(local, sync)));
browser.runtime.onInstalled.addListener(() => soon('reconcile', () => reconcile(local, sync)));
