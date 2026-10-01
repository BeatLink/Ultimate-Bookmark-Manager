import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom, settle } from './browser-env.js';
import { openDashboard, main, click, answer, toasts, clearToasts, reload, catchDownloads } from './ui-view-helpers.js';
import { FORMAT } from '../src/lib/transfer.js';

const tree = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [
    { id: 'w1', title: 'Work', children: [{ id: 'x', title: 'X', url: 'https://x.test/' }] },
    { id: 'w2', title: 'Work', children: [] },
    { id: 'slash', title: 'A/B', children: [] },
  ] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

const browser = await openDashboard({
  view: 'settings',
  tree: tree(),
  local: {
    syncEnabled: false,
    settings: { organize: { rules: [], autoApply: true } },
    whitelist: {
      b1: { title: 'Ignored page', url: 'https://ignored.test/' },
      f1: { title: '', url: '', inside: true },
    },
  },
});
after(uninstallDom);
const downloads = catchDownloads();

const saved = () => browser.storage.local.data.settings;

// The control inside the label whose text starts with `text`.
function control(text, selector = 'input, textarea, select') {
  const label = [...main().querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(text));
  assert.ok(label, `no label “${text}”`);
  return label.querySelector(selector);
}

// Types a value into a control and fires the event its handler listens for.
function enter(el, value, event = 'change') {
  if (el.type === 'checkbox') el.checked = value;
  else el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

const fieldset = (legend) => [...main().querySelectorAll('fieldset')].find((f) => f.querySelector('legend').textContent.startsWith(legend));
const rules = () => [...main().querySelectorAll('li.rule')];

test('the page shows the saved settings in each section', () => {
  assert.equal(main().querySelector('h1').textContent, 'Settings');
  assert.equal(control('Treat http and https as the same').checked, false);
  assert.equal(control('Parallel requests').value, '6');
  assert.equal(control('Timeout (seconds)').value, '15');
  assert.equal(control('Folder for moved duplicates').value, 'Dupes');
  assert.equal(rules().length, 0);
});

test('sync shows as off when it has been turned off', () => {
  const sync = fieldset('Sync & backup');
  assert.equal(sync.querySelector('input[type=checkbox]').checked, false);
  assert.equal(sync.querySelector('input[type=checkbox]').disabled, false);
  assert.match(sync.querySelector('p.muted').textContent, /Sync is off; settings stay on this device\./);
});

test('saving stores the changed matching options and keeps the saved organize settings', async () => {
  clearToasts();
  enter(control('Ignore the query string'), true);
  enter(control('Ignore letter case'), true);
  await click('Save settings');
  assert.equal(saved().matching.ignoreQuery, true);
  assert.equal(saved().matching.ignoreCase, true);
  assert.equal(saved().organize.autoApply, true);
  assert.match(toasts(), /Settings saved\./);
});

test('unsaved edits survive a refresh until they are discarded', async () => {
  enter(control('Ignore the query string'), false);
  await reload();
  assert.equal(control('Ignore the query string').checked, false);
  await click('Discard changes');
  assert.equal(control('Ignore the query string').checked, true);
  assert.equal(saved().matching.ignoreQuery, true);
});

test('an untouched form follows settings changed elsewhere', async () => {
  await browser.storage.local.set({ settings: { ...saved(), dupesFolderName: 'Copies' } });
  await reload();
  assert.equal(control('Folder for moved duplicates').value, 'Copies');
});

test('link-check numbers are kept within their allowed range', async () => {
  enter(control('Parallel requests'), '99');
  enter(control('Timeout (seconds)'), '1');
  enter(control('Undo history length'), '0');
  enter(control('Forget undo history after'), '99999');
  await click('Save settings');
  assert.equal(saved().linkCheck.concurrency, 32);
  assert.equal(saved().linkCheck.timeoutSeconds, 3);
  assert.equal(saved().historyLimit, 50, 'zero is not a number the field accepts, so the default is used');
  assert.equal(saved().historyDays, 3650);
  enter(control('Parallel requests'), 'abc');
  enter(control('Timeout (seconds)'), '500');
  enter(control('Undo history length'), '900');
  enter(control('Forget undo history after'), '');
  await click('Save settings');
  assert.equal(saved().linkCheck.concurrency, 6);
  assert.equal(saved().linkCheck.timeoutSeconds, 120);
  assert.equal(saved().historyLimit, 500);
  assert.equal(saved().historyDays, 30);
  enter(control('Timeout (seconds)'), '');
  await click('Save settings');
  assert.equal(saved().linkCheck.timeoutSeconds, 15);
});

test('lists are saved one entry per line, ignoring blank lines and spaces', async () => {
  enter(control('Skip these domains'), ' intranet.test \n\n nas.local ');
  enter(control('Never send cookies'), 'logout\ndelete');
  enter(control('Login services'), 'sso.test');
  enter(control('Skip addresses on your own network'), false);
  enter(control('Send your cookies'), true);
  enter(control('List redirects to a login page'), false);
  enter(control('Folder for moved duplicates'), '   ');
  await click('Save settings');
  const lc = saved().linkCheck;
  assert.deepEqual(lc.skipDomains, ['intranet.test', 'nas.local']);
  assert.deepEqual(lc.noCookieWords, ['logout', 'delete']);
  assert.deepEqual(lc.loginHosts, ['sso.test']);
  assert.equal(lc.skipPrivate, false);
  assert.equal(lc.useCookies, true);
  assert.equal(lc.detectLogin, false);
  assert.equal(saved().dupesFolderName, 'Dupes');
  assert.equal(control('Skip these domains').value, 'intranet.test\nnas.local');
});

test('custom rules can be added from scratch or from a preset and edited', async () => {
  await click('Add rule');
  await click('+ Strip tracking parameters');
  assert.equal(rules().length, 2);
  const [first, second] = rules();
  const [kind, field] = first.querySelectorAll('select');
  const replacement = first.querySelector('input[aria-label=Replacement]');
  assert.equal(field.hidden, false);
  assert.equal(replacement.hidden, true);
  enter(first.querySelector('input[aria-label=Pattern]'), '^https://skip\\.test/', 'input');
  enter(first.querySelector('input[aria-label=Flags]'), '', 'input');
  enter(field, 'title');
  enter(kind, 'replace');
  assert.equal(field.hidden, true);
  assert.equal(replacement.hidden, false);
  enter(replacement, 'https://kept.test/', 'input');
  enter(kind, 'filter');
  enter(second.querySelector('input[aria-label=Enabled]'), false);
  assert.equal(second.querySelector('select[aria-label="Rule type"]').value, 'replace');
  await click('Save settings');
  assert.deepEqual(saved().duplicateRules, [
    { enabled: true, kind: 'filter', field: 'title', pattern: '^https://skip\\.test/', flags: '', replacement: 'https://kept.test/' },
    { enabled: false, kind: 'replace', pattern: '([?&])(utm_[^=&#]*|fbclid|gclid|mc_eid)=[^&#]*', flags: 'i', replacement: '$1' },
  ]);
});

test('an invalid rule shows its error under it once saved', async () => {
  await click('+ Skip bookmarklets');
  await click('+ Skip a folder by name');
  enter(rules()[3].querySelector('input[aria-label=Pattern]'), '(', 'input');
  await click('Save settings');
  assert.equal(rules().length, 4);
  assert.ok(rules()[3].querySelector('.error').textContent.length > 0);
  assert.equal(rules()[2].querySelector('.error'), null);
});

test('removing a rule takes it out of the list', async () => {
  await click('Remove', rules()[3]);
  await click('Remove', rules()[0]);
  assert.equal(rules().length, 2);
  await click('Save settings');
  assert.deepEqual(saved().duplicateRules.map((r) => r.pattern), ['([?&])(utm_[^=&#]*|fbclid|gclid|mc_eid)=[^&#]*', '^javascript:']);
});

test('a saved rule missing some parts shows them blank, matching URLs', async () => {
  const before = saved().duplicateRules;
  await browser.storage.local.set({ settings: { ...saved(), duplicateRules: [{ kind: 'filter' }] } });
  await reload();
  const [only] = rules();
  assert.equal(only.querySelector('select[aria-label="Match against"]').value, 'url');
  assert.equal(only.querySelector('input[aria-label=Pattern]').value, '');
  assert.equal(only.querySelector('input[aria-label=Flags]').value, '');
  assert.equal(only.querySelector('input[aria-label=Replacement]').value, '');
  assert.equal(only.querySelector('input[aria-label=Enabled]').checked, true);
  await browser.storage.local.set({ settings: { ...saved(), duplicateRules: before } });
  await reload();
  assert.equal(rules().length, 2);
});

test('ignored items are listed with their URL or as a whole folder', () => {
  const box = fieldset('Ignored items');
  assert.match(box.querySelector('legend').textContent, /Ignored items \(2\)/);
  const items = [...box.querySelectorAll('li.item')];
  assert.equal(items[0].querySelector('.bm-title').textContent, 'Ignored page');
  assert.equal(items[0].querySelector('.bm-url').textContent, 'https://ignored.test/');
  assert.equal(items[1].querySelector('.bm-title').textContent, '(no name)');
  assert.equal(items[1].querySelector('.bm-meta').textContent, 'Folder, with everything inside');
});

test('Stop ignoring removes an item from the whitelist', async () => {
  await click('Stop ignoring', fieldset('Ignored items').querySelector('li.item'));
  assert.deepEqual(Object.keys(browser.storage.local.data.whitelist), ['f1']);
  assert.match(fieldset('Ignored items').querySelector('legend').textContent, /Ignored items \(1\)/);
});

test('cancelling Ignore a folder changes nothing', async () => {
  await click('Ignore a folder…');
  const dialog = document.querySelector('dialog[open]');
  assert.equal(dialog.querySelector('h2').textContent, 'Ignore a folder and everything inside');
  assert.equal(dialog.querySelector('input[aria-label="New subfolder name"]'), null);
  await answer(false);
  assert.deepEqual(Object.keys(browser.storage.local.data.whitelist), ['f1']);
});

test('ignoring a folder ignores every same-name folder at that path, with everything inside', async () => {
  clearToasts();
  await click('Ignore a folder…');
  const dialog = document.querySelector('dialog[open]');
  dialog.querySelector('[data-path="Bookmarks Menu/Work"]').click();
  await answer(true);
  const { whitelist } = browser.storage.local.data;
  assert.deepEqual(whitelist.w1, { title: 'Work', url: '', inside: true });
  assert.deepEqual(whitelist.w2, { title: 'Work', url: '', inside: true });
  assert.match(toasts(), /Every check now skips “Bookmarks Menu › Work” and everything inside it\./);
});

test('with nothing ignored the list says so', async () => {
  await browser.storage.local.set({ whitelist: {} });
  await reload();
  assert.equal(fieldset('Ignored items').querySelector('.empty-state').textContent, 'Nothing is ignored.');
});

test('turning sync on uploads this device’s settings', async () => {
  clearToasts();
  const toggle = fieldset('Sync & backup').querySelector('input[type=checkbox]');
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change'));
  await settle(20);
  assert.match(toasts(), /Sync turned on; settings uploaded\./);
  assert.equal(browser.storage.local.data.syncEnabled, true);
  assert.ok(browser.storage.sync.data.cfg_meta);
  assert.match(fieldset('Sync & backup').querySelector('p.muted').textContent, /^Last synced /);
});

test('the sync status follows background syncs, including partial and failed ones', async () => {
  await browser.storage.local.set({ syncState: { partial: true, error: 'Quota exceeded' } });
  await settle(10);
  const status = fieldset('Sync & backup').querySelector('p.muted').textContent;
  assert.match(status, /Waiting for the first sync\./);
  assert.match(status, /The ignore list is too large to sync/);
  assert.match(status, /Last sync failed: Quota exceeded/);
});

test('turning sync off says so', async () => {
  clearToasts();
  const toggle = fieldset('Sync & backup').querySelector('input[type=checkbox]');
  toggle.checked = false;
  toggle.dispatchEvent(new Event('change'));
  await settle(20);
  assert.match(toasts(), /Sync turned off\./);
  assert.equal(browser.storage.local.data.syncEnabled, false);
});

test('turning sync on when another device synced different settings asks which to keep', async () => {
  // Another device's payload, chunked the way push stores it.
  const text = JSON.stringify({ settings: { dupesFolderName: 'Remote' }, whitelist: {} });
  const { fingerprint } = await import('../src/lib/sync.js');
  await browser.storage.sync.set({ cfg_0: text, cfg_meta: { hash: fingerprint(text), chunks: 1, updated: 1, partial: false } });
  clearToasts();
  const toggle = fieldset('Sync & backup').querySelector('input[type=checkbox]');
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change'));
  await settle(20);
  assert.match(await answer(true), /Another device has already synced different settings\./);
  await settle(20);
  assert.match(toasts(), /Sync turned on; synced settings applied\./);
  assert.equal(saved().dupesFolderName, 'Remote');
  assert.equal(control('Folder for moved duplicates').value, 'Remote');
});

test('a sync that fails is recorded instead of reporting success', async () => {
  clearToasts();
  const toggle = fieldset('Sync & backup').querySelector('input[type=checkbox]');
  toggle.checked = false;
  toggle.dispatchEvent(new Event('change'));
  await settle(20);
  const set = browser.storage.sync.set;
  browser.storage.sync.set = async () => { throw new Error('Sync is unavailable'); };
  await browser.storage.sync.remove(['cfg_meta', 'cfg_0']);
  clearToasts();
  fieldset('Sync & backup').querySelector('input[type=checkbox]').checked = true;
  fieldset('Sync & backup').querySelector('input[type=checkbox]').dispatchEvent(new Event('change'));
  await settle(20);
  browser.storage.sync.set = set;
  assert.doesNotMatch(toasts(), /Sync turned on/);
  assert.equal(browser.storage.local.data.syncState.error, 'Sync is unavailable');
});

test('Export settings saves settings and ignored items to a file', async () => {
  clearToasts();
  await browser.storage.local.set({ whitelist: { k: { title: 'Kept out', url: 'https://k.test/' } } });
  await click('Export settings…');
  assert.equal(downloads.length, 1);
  assert.match(downloads[0].name, /^ultimate-bookmark-manager-settings-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await downloads[0].blob.text());
  assert.equal(data.format, FORMAT);
  assert.equal(data.settings.dupesFolderName, 'Remote');
  assert.deepEqual(data.whitelist, { k: { title: 'Kept out', url: 'https://k.test/' } });
  assert.match(toasts(), /Settings exported\./);
});

// Hands a file to the import input, as picking it in the file dialog would.
async function importFile(file) {
  const input = fieldset('Sync & backup').querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
  input.dispatchEvent(new Event('change'));
  await settle(15);
}

test('Import settings opens the file picker', async () => {
  const input = fieldset('Sync & backup').querySelector('input[type=file]');
  let opened = 0;
  input.addEventListener('click', () => opened++);
  await click('Import settings…');
  assert.equal(opened, 1);
});

test('importing a file that is not a settings file reports why', async () => {
  clearToasts();
  await importFile(new File(['{}'], 'other.json'));
  assert.match(document.querySelector('#toasts .error').textContent, /Could not import: This is not an Ultimate Bookmark Manager settings file\./);
  await importFile(null);
  assert.equal(document.querySelector('dialog[open]'), null);
});

test('importing settings asks first, then replaces settings and adds ignored items', async () => {
  const file = () => new File([JSON.stringify({
    format: FORMAT, version: 1,
    settings: { dupesFolderName: 'Imported' },
    whitelist: { z: { title: 'From file', url: 'https://z.test/' } },
  })], 'mine.json');
  await importFile(file());
  assert.equal(await answer(false), 'Replace your settings with the ones in “mine.json” (0 organize rule(s))? Its 1 ignored item(s) are added to yours.');
  assert.equal(saved().dupesFolderName, 'Remote');
  clearToasts();
  enter(control('Ignore letter case'), false);
  await importFile(file());
  await answer(true);
  assert.equal(saved().dupesFolderName, 'Imported');
  assert.deepEqual(Object.keys(browser.storage.local.data.whitelist).sort(), ['k', 'z']);
  assert.match(toasts(), /Settings imported\./);
  assert.equal(control('Folder for moved duplicates').value, 'Imported');
  assert.equal(control('Ignore letter case').checked, false, 'imported settings use the defaults, replacing the unsaved edit');
});

test('importing a file without ignored items does not mention them', async () => {
  await importFile(new File([JSON.stringify({ format: FORMAT, version: 1, settings: {} })], 'bare.json'));
  assert.equal(await answer(false), 'Replace your settings with the ones in “bare.json” (0 organize rule(s))?');
});

test('the help links on the page lead to the Settings help', () => {
  const links = [...main().querySelectorAll('legend .help-link')];
  assert.ok(links.length >= 4);
  assert.ok(links.every((a) => a.getAttribute('href') === '#help:settings'));
});
