// Entry points: toolbar button, keyboard shortcut, Tools menu and the "bm" address-bar keyword.

const VIEWS = {
  duplicates: 'Duplicates',
  'empty-folders': 'Empty folders',
  'same-name': 'Same-name folders',
  untitled: 'Bookmarks without a name',
  broken: 'Broken links',
  redirects: 'Redirects',
  all: 'All bookmarks',
  history: 'Undo history & backup',
  settings: 'Settings',
};

// Focuses an open dashboard tab if there is one, otherwise opens a new one.
async function openDashboard(view = 'duplicates') {
  const focused = await browser.runtime.sendMessage({ type: 'focus-dashboard', view }).catch(() => false);
  if (!focused) await browser.tabs.create({ url: browser.runtime.getURL(`src/ui/app.html#${view}`) });
}

browser.action.onClicked.addListener(() => openDashboard());

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
  openDashboard(match ?? 'duplicates');
});
