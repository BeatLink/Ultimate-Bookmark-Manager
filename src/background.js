// Entry points (toolbar button, keyboard shortcut, Tools menu, "bm" address-bar keyword) and rules run on new bookmarks.

import { loadSettings, loadWhitelist, loadLinkResults, addNewCookieWords } from './lib/settings.js';
import { planRules, knownPages, hasEffect } from './lib/rule-plan.js';
import { loadPageDetails } from './lib/page-titles.js';
import { fetchOptions } from './lib/linkcheck.js';
import { ignoredIdSet } from './lib/folders.js';
import { flatten, rootFoldersOf } from './lib/tree.js';
import { Actions } from './lib/actions.js';
import { push, pull, reconcile, isSyncEnabled, isSyncKey, guarded } from './lib/sync.js';
import { VisitWatcher } from './lib/page-visits.js';

const VIEWS = {
  stats: 'Dashboard',
  duplicates: 'Duplicates',
  'empty-folders': 'Empty folders',
  'same-name': 'Same-name folders',
  untitled: 'Bookmarks without a useful name',
  broken: 'Broken links',
  redirects: 'Redirects',
  rules: 'Rules',
  'find-replace': 'Find and replace',
  all: 'All bookmarks',
  history: 'Undo history & backup',
  settings: 'Settings',
  help: 'Help',
};

// New bookmarks wait this long before rules run on them, so a folder picked in the star panel wins.
const AUTO_DELAY_MS = 4000;
// More new bookmarks than this at once means an import, sync or "bookmark all tabs", which is left alone.
const BURST_LIMIT = 20;
// Settings changes settle for this long before they are synced.
const SYNC_DELAY_MS = 1000;

// Focuses an open dashboard tab if there is one, otherwise opens a new one.
async function openDashboard(view = 'stats') {
  const focused = await browser.runtime.sendMessage({ type: 'focus-dashboard', view }).catch(() => false);
  if (!focused) await browser.tabs.create({ url: browser.runtime.getURL(`src/ui/app.html#${view}`) });
}

browser.action.onClicked.addListener(() => openDashboard());

// Removes storage entries this version no longer uses.
async function removeLeftovers() {
  await browser.storage.local.remove(['aiSummaries', 'aiResume']);
  const { settings } = await browser.storage.local.get('settings');
  if (settings && 'ai' in settings) {
    delete settings.ai;
    await browser.storage.local.set({ settings });
  }
}
browser.runtime.onInstalled.addListener(() => removeLeftovers().catch((err) => console.error('Cleanup failed', err)));
browser.runtime.onInstalled.addListener(() => addNewCookieWords().catch((err) => console.error('Updating the never-send-cookies words failed', err)));

browser.commands.onCommand.addListener((command) => {
  if (command === 'open-dashboard') openDashboard();
});

browser.runtime.onInstalled.addListener(() => {
  browser.menus.removeAll();
  browser.menus.create({ id: 'root', title: 'Ultimate Bookmark Manager', contexts: ['tools_menu'] });
  for (const [id, title] of Object.entries(VIEWS)) {
    browser.menus.create({ id: `view:${id}`, parentId: 'root', title, contexts: ['tools_menu'] });
  }
});

browser.menus.onClicked.addListener((info) => {
  if (String(info.menuItemId).startsWith('view:')) openDashboard(info.menuItemId.slice(5));
});

browser.omnibox.setDefaultSuggestion({ description: 'Ultimate Bookmark Manager — type a view: duplicates, broken, redirects, empty-folders, untitled…' });

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

const pending = new Map();
let autoTimer;

browser.bookmarks.onCreated.addListener((id, node) => {
  if (!node.url) return;
  pending.set(id, node.parentId);
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => runRulesOnNew().catch((err) => console.error('Running rules on new bookmarks failed', err)), AUTO_DELAY_MS);
});

async function runRulesOnNew() {
  const batch = new Map(pending);
  pending.clear();
  if (batch.size > BURST_LIMIT) return;
  const settings = await loadSettings();
  const rules = settings.organize.rules.filter((r) => r.autoRun);
  if (!rules.length) return;

  // Bookmarks brought back by an undo appear in the history's id map and must not be moved again.
  const { history } = await browser.storage.local.get('history');
  const restored = new Set(Object.values(history?.idMap ?? {}));
  const [root] = await browser.bookmarks.getTree();
  const all = flatten(root);
  const fresh = all.filter((b) => batch.get(b.id) === b.parentId && !restored.has(b.id));
  const ignored = ignoredIdSet(root, await loadWhitelist());
  const pages = knownPages(await loadLinkResults());
  const plan = (pageInfo) => planRules(fresh, rules, rootFoldersOf(root), { ignoredIds: ignored, tree: all, pages: pageInfo }).changes;
  let changes = plan(pages);
  // Pages are read only when the add-on may already load websites, as a background task cannot ask.
  const waiting = changes.filter((c) => c.waiting).map((c) => c.bookmark);
  if (waiting.length && await browser.permissions.contains({ origins: ['<all_urls>'] })) {
    const read = await loadPageDetails(waiting, fetchOptions(settings.linkCheck));
    for (const b of waiting) pages.set(b.id, { ...read.get(b.id), url: b.url, read: true });
    changes = plan(pages);
  }
  changes = changes.filter((c) => hasEffect(c) && !c.problem);
  if (!changes.length) return;

  const label = changes.length === 1 ? `Ran rules on “${changes[0].bookmark.title || changes[0].bookmark.url}”` : `Ran rules on ${changes.length} new bookmarks`;
  await new Actions({ limit: settings.historyLimit, days: settings.historyDays }).applyRules(changes.map((c) => ({ ...c, id: c.bookmark.id })), label);
}

// Settings sync: local edits are uploaded and changes from other devices applied, each after a short pause.
const local = browser.storage.local;
const sync = browser.storage.sync;
const syncTimers = {};

function soon(name, step) {
  clearTimeout(syncTimers[name]);
  syncTimers[name] = setTimeout(async () => {
    if (await isSyncEnabled(local)) await guarded(local, step);
  }, SYNC_DELAY_MS);
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ('settings' in changes || 'whitelist' in changes)) soon('push', () => push(local, sync));
  if (area === 'sync' && Object.keys(changes).some(isSyncKey)) soon('pull', () => pull(local, sync));
});

browser.runtime.onStartup.addListener(() => soon('reconcile', () => reconcile(local, sync)));
browser.runtime.onInstalled.addListener(() => soon('reconcile', () => reconcile(local, sync)));

// Undo history past its age limit is forgotten at startup, even if the dashboard is never opened.
browser.runtime.onStartup.addListener(() => loadSettings()
  .then((settings) => new Actions({ limit: settings.historyLimit, days: settings.historyDays }).load())
  .catch((err) => console.error('Clearing old undo history failed', err)));

// Opened bookmarked pages update their saved details once the permissions the setting asks for are granted.
const visitWatcher = new VisitWatcher(browser);
visitWatcher.watch();
browser.permissions.onAdded.addListener(() => visitWatcher.watch());
