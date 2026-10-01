import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom } from './browser-env.js';
import { openDashboard, main, click, findButton, reload, show } from './ui-view-helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const ago = (days) => now - days * DAY;

const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'd1', title: 'Docs', url: 'https://docs.python.test/a', dateAdded: ago(70) },
    { id: 'd2', title: 'Docs copy', url: 'https://docs.python.test/a', dateAdded: ago(40) },
    { id: 'news', title: 'Daily news', url: 'http://news.test/', dateAdded: ago(10) },
    { id: 'sep', type: 'separator' },
    { id: 'deep', title: 'Deep', children: [
      { id: 'deeper', title: 'Deeper', children: [{ id: 'bottom', title: '', url: 'https://bottom.test/', dateAdded: ago(1) }] },
    ] },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [
    { id: 'js', title: 'Bookmarklet', url: 'javascript:alert(1)', dateAdded: ago(5) },
    { id: 'e1', title: 'Empty', children: [] },
    { id: 'e2', title: 'Empty', children: [] },
  ] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

const rule = {
  id: 'r1', name: 'News', enabled: true, target: 'Bookmarks Toolbar/News', outranks: [], createdAt: 1,
  query: { id: 'g1', combinator: 'or', not: false, rules: [{ id: 'c1', field: 'either', operator: 'contains', value: 'news', caseSensitive: false, wholeWords: false }] },
};

const browser = await openDashboard({
  view: 'stats',
  tree: tree(),
  local: { settings: { organize: { rules: [rule], autoApply: false } }, whitelist: { gone: { title: 'Gone', url: '' } } },
});
after(uninstallDom);

// Each tile's label mapped to its value and note.
function tiles() {
  return Object.fromEntries([...main().querySelectorAll('.stat-tile')].map((t) => [
    t.querySelector('.stat-label').textContent,
    { value: t.querySelector('.stat-value').textContent, note: t.querySelector('.stat-note')?.textContent, href: t.getAttribute('href'), muted: t.classList.contains('muted-tile') },
  ]));
}
const card = (title) => [...main().querySelectorAll('.viz-card')].find((c) => c.querySelector('h2').textContent.startsWith(title));

test('the headline counts bookmarks, folders and sites', () => {
  const hero = tiles().Bookmarks;
  assert.equal(hero.value, '5');
  assert.equal(hero.note, 'in 8 folders, from 4 sites');
  assert.equal(hero.href, '#all');
});

test('each tidy-up tile counts what its page deals with and links to it', () => {
  const t = tiles();
  assert.deepEqual(t['Duplicate copies'], { value: '1', note: undefined, href: '#duplicates', muted: false });
  assert.equal(t['No useful name'].value, '1');
  assert.equal(t['Empty folders'].value, '2');
  assert.equal(t['Same-name folders'].value, '1');
  assert.equal(t['Waiting to be organized'].value, '1');
  assert.deepEqual(t.Ignored, { value: '1', note: undefined, href: '#settings', muted: false });
});

test('before a link check the link tiles show a dash', () => {
  const t = tiles();
  assert.deepEqual(t['Broken links'], { value: '–', note: 'Not checked yet', href: '#broken', muted: true });
  assert.deepEqual(t.Redirects, { value: '–', note: 'Not checked yet', href: '#redirects', muted: true });
});

test('after a link check the link tiles count broken links and redirects', async () => {
  await browser.storage.local.set({ linkResults: {
    time: now, checked: 5, skipped: 1,
    results: [
      { id: 'd1', url: 'https://docs.python.test/a', status: 'broken', category: 'notFound' },
      { id: 'news', url: 'http://news.test/', status: 'redirect', finalUrl: 'https://news.test/' },
      { id: 'd2', url: 'https://docs.python.test/a', status: 'uncertain', category: 'denied' },
    ],
  } });
  await reload();
  const t = tiles();
  assert.equal(t['Broken links'].value, '2');
  assert.match(t['Broken links'].note, /^checked /);
  assert.equal(t.Redirects.value, '1');
  assert.equal(t.Redirects.muted, false);
});

test('the site chart lists sites with subdomains folded in, and its table has every share', async () => {
  const sites = card('Bookmarks by site');
  assert.equal(sites.querySelector('.muted.small').textContent, 'Top 4 of 4 sites, holding 100% of all bookmarks.');
  assert.deepEqual([...sites.querySelectorAll('.bar-label')].map((l) => l.textContent), ['python.test', '(javascript)', 'bottom.test', 'news.test']);
  const table = sites.querySelector('table');
  assert.equal(table.hidden, true);
  await click('Table', sites);
  assert.equal(table.hidden, false);
  assert.equal(findButton('Chart', sites).getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...table.querySelectorAll('tbody tr')][0].textContent, 'python.test240.0%');
  await click('Chart', sites);
  assert.equal(table.hidden, true);
});

test('selecting a site lists its bookmarks on the All bookmarks page', async () => {
  const sites = card('Bookmarks by site');
  sites.querySelector('button.bar-row').click();
  await show('all');
  assert.equal(document.querySelector('#main input[type=search]').value, 'python.test');
  await show('stats');
});

test('selecting a non-web kind of URL opens All bookmarks without a search', async () => {
  const row = [...card('Bookmarks by site').querySelectorAll('button.bar-row')].find((b) => b.textContent.startsWith('(javascript)'));
  row.click();
  await show('all');
  assert.equal(document.querySelector('#main input[type=search]').value, '');
  await show('stats');
});

test('the month chart covers every month from the first bookmark to now', () => {
  const months = card('Added per month');
  assert.ok(months.classList.contains('wide'));
  const cols = months.querySelectorAll('.col');
  assert.ok(cols.length >= 3 && cols.length <= 4);
  assert.doesNotMatch(months.querySelector('.muted.small').textContent, /three years/);
  const labels = [...months.querySelectorAll('.col-labels span')].map((s) => s.textContent);
  assert.equal(labels[0], String(new Date(ago(70)).getFullYear()));
});

test('the recent list shows the newest bookmarks first, by name or else URL', () => {
  const recent = card('Recently bookmarked');
  assert.equal(recent.querySelector('.muted.small').textContent, 'The newest 5, newest first.');
  assert.deepEqual([...recent.querySelectorAll('li a')].map((a) => a.textContent), ['https://bottom.test/', 'Bookmarklet', 'Daily news', 'Docs copy', 'Docs']);
});

test('See all lists every bookmark newest first on the All bookmarks page', async () => {
  await click('See all', card('Recently bookmarked'));
  assert.equal(location.hash, '#all');
  await show('stats');
});

test('the location, folder and URL type charts count bookmarks', () => {
  assert.deepEqual([...card('Where they are').querySelectorAll('.bar-label')].map((l) => l.textContent), ['Bookmarks Menu', 'Bookmarks Toolbar']);
  assert.equal(card('Largest folders').querySelector('.muted.small').textContent, 'Top 3 of 3 folders that hold any.');
  assert.deepEqual([...card('URL types').querySelectorAll('.bar-label')].map((l) => l.textContent), ['https', 'http', 'javascript']);
});

test('the facts give the oldest and newest bookmark, the deepest level and separators', () => {
  const facts = Object.fromEntries([...main().querySelectorAll('.fact')].map((f) => [f.querySelector('.stat-label').textContent, f]));
  assert.equal(facts['Oldest bookmark'].querySelector('a').textContent, 'Docs');
  assert.equal(facts['Newest bookmark'].querySelector('a').textContent, 'https://bottom.test/');
  assert.equal(facts['Deepest folder level'].querySelector('.fact-value').textContent, '3');
  assert.equal(facts.Separators.querySelector('.fact-value').textContent, '1');
});

test('with bookmarks over three years old the month chart shows only the last three years', async () => {
  await browser.bookmarks.update('d1', { dateAdded: ago(2000) });
  await reload();
  const months = card('Added per month');
  assert.equal(months.querySelectorAll('.col').length, 36);
  assert.match(months.querySelector('.muted.small').textContent, /\(the last three years\)\.$/);
});

test('with a single month of bookmarks there is no month chart', async () => {
  for (const id of ['d1', 'd2', 'news', 'js']) await browser.bookmarks.remove(id);
  await browser.bookmarks.update('bottom', { dateAdded: now });
  await reload();
  assert.equal(card('Added per month'), undefined);
  assert.equal(tiles()['Duplicate copies'].muted, true);
});

test('with no bookmarks the dashboard says so', async () => {
  await browser.bookmarks.removeTree('deep');
  await reload();
  assert.equal(main().querySelector('.empty-state').textContent, 'No bookmarks yet.');
});
