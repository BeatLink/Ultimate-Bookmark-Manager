// Settings: duplicate matching, custom rules, link-check tuning, skip list and whitelist.

import { h, toast, confirmDialog, downloadFile, datedName } from '../dom.js';
import { viewHeader, emptyState, helpLink, pickFolder } from '../components.js';
import { saveSettings, addToWhitelist, removeFromWhitelist, DEFAULT_SETTINGS, RANGES } from '../../lib/settings.js';
import { isFolder } from '../../lib/tree.js';
import { folderLabel } from '../../lib/rules.js';
import { compileRules } from '../../lib/duplicates.js';
import { buildExport, parseImport, applyImport } from '../../lib/transfer.js';
import { isSyncEnabled, syncStatus, hasConflictingRemote, enableSync, disableSync, guarded } from '../../lib/sync.js';

// Unsaved edits survive a refresh; an untouched draft follows the saved settings when they change.
let draft = null;
let draftBase = null;

const MATCHING = [
  ['ignoreProtocol', 'Treat http and https as the same'],
  ['ignoreWww', 'Treat “www.” and no “www.” as the same'],
  ['ignoreTrailingSlash', 'Ignore a trailing slash'],
  ['ignoreFragment', 'Ignore the part after “#”'],
  ['ignoreQuery', 'Ignore the query string (after “?”)'],
  ['ignoreCase', 'Ignore letter case in the whole URL'],
];

const PRESETS = [
  { name: 'Strip tracking parameters', rule: { kind: 'replace', pattern: '([?&])(utm_[^=&#]*|fbclid|gclid|mc_eid)=[^&#]*', flags: 'i', replacement: '$1' } },
  { name: 'Skip bookmarklets', rule: { kind: 'filter', field: 'url', pattern: '^javascript:', flags: 'i' } },
  { name: 'Skip a folder by name', rule: { kind: 'filter', field: 'name', pattern: '^Bookmarks Toolbar/Keep/', flags: '' } },
];

// A section heading with its help link.
const legend = (text, tip) => h('legend', {}, text, ' ', helpLink(tip, 'settings'));
const splitLines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

// A checkbox that writes straight into `obj[key]`.
const checkLine = (obj, key, label) => h('label', { class: 'check-line' },
  h('input', { type: 'checkbox', checked: obj[key], onchange: (e) => { obj[key] = e.target.checked; } }), label);

// A number field held to the range the settings allow, falling back to the default when left blank.
const numberField = (obj, key, label, fallback) => {
  const [min, max] = RANGES[key];
  return h('label', { class: 'field' }, label,
    h('input', { type: 'number', min, max, value: String(obj[key]), onchange: (e) => { obj[key] = Math.min(max, Math.max(min, Number(e.target.value) || fallback)); } }));
};

// A text area whose lines are a list of text.
const linesField = (obj, key, label, rows) => h('label', { class: 'field block' }, label,
  h('textarea', { rows, class: 'mono', onchange: (e) => { obj[key] = splitLines(e.target.value); } }, obj[key].join('\n')));

// Every folder at a "Root/Sub/Folder" path, as several same-name folders can share one.
function foldersAt(root, path) {
  let level = [root];
  for (const name of path.split('/')) {
    level = level.flatMap((n) => (n.children ?? []).filter((c) => isFolder(c) && (c.title ?? '') === name));
  }
  return level;
}

// Asks for a folder and ignores it with everything inside it.
async function ignoreFolder(ctx) {
  const path = await pickFolder(ctx.state.root, '', { heading: 'Ignore a folder and everything inside', verb: 'Ignore', allowCreate: false });
  if (!path) return;
  const folders = foldersAt(ctx.state.root, path);
  await ctx.run(async () => {
    await addToWhitelist(folders.map((f) => ({ id: f.id, title: f.title, inside: true })));
    toast(`Every check now skips “${folderLabel(path)}” and everything inside it.`, 'success');
  });
}

// Sync toggle and status, plus exporting and importing settings files.
function syncAndBackup(ctx) {
  const local = browser.storage.local;
  const sync = browser.storage.sync;
  const toggle = h('input', { type: 'checkbox', disabled: true });
  const status = h('p', { class: 'muted small', text: 'Checking sync…' });

  const showStatus = async () => {
    const [enabled, state] = await Promise.all([isSyncEnabled(local), syncStatus(local)]);
    toggle.checked = enabled;
    toggle.disabled = false;
    const parts = [];
    if (!enabled) parts.push(h('span', { text: 'Sync is off; settings stay on this device.' }));
    else if (state.time) parts.push(h('span', { text: `Last synced ${new Date(state.time).toLocaleString()}.` }));
    else parts.push(h('span', { text: 'Waiting for the first sync.' }));
    if (enabled && state.partial) parts.push(h('span', { class: 'warn', text: ' The ignore list is too large to sync, so only settings and rules are synced.' }));
    if (enabled && state.error) parts.push(h('span', { class: 'error', text: ` Last sync failed: ${state.error}` }));
    status.replaceChildren(...parts);
  };

  toggle.addEventListener('change', () => ctx.run(async () => {
    if (!toggle.checked) {
      await disableSync(local);
      toast('Sync turned off.', 'success');
      return;
    }
    const conflict = await guarded(local, () => hasConflictingRemote(local, sync));
    const preferRemote = conflict === true && await confirmDialog(
      'Another device has already synced different settings. Use those here? Cancel keeps this device’s settings and replaces the synced ones.',
      'Use synced settings', false);
    const result = await guarded(local, () => enableSync(local, sync, { preferRemote }));
    if (result !== 'error') toast(preferRemote ? 'Sync turned on; synced settings applied.' : 'Sync turned on; settings uploaded.', 'success');
  }));

  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
    const [chosen] = file.files;
    file.value = '';
    if (!chosen) return;
    let parsed;
    try {
      parsed = parseImport(await chosen.text());
    } catch (err) {
      toast(`Could not import: ${err.message}`, 'error');
      return;
    }
    const ignored = Object.keys(parsed.whitelist).length;
    if (!(await confirmDialog(`Replace your settings with the ones in “${chosen.name}” (${parsed.rules} organize rule(s))?${ignored ? ` Its ${ignored} ignored item(s) are added to yours.` : ''}`, 'Import', false))) return;
    await ctx.run(async () => {
      await applyImport(parsed);
      draft = null;
      toast('Settings imported.', 'success');
    });
  } });

  showStatus();
  // Background syncs update the status line while the page is open; the listener retires once the view is replaced.
  const onChange = (changes, area) => {
    if (!status.isConnected) return browser.storage.onChanged.removeListener(onChange);
    if (area === 'local' && ('syncState' in changes || 'syncEnabled' in changes)) showStatus();
  };
  browser.storage.onChanged.addListener(onChange);
  return h('fieldset', {}, legend('Sync & backup', 'Needs Firefox signed in to a Mozilla account, with Add-ons ticked in Firefox’s Sync settings'),
    h('label', { class: 'check-line' }, toggle, 'Sync settings, organize rules and ignored items with Firefox Sync'),
    status,
    h('div', { class: 'row wrap' },
      h('button', { text: 'Export settings…', title: 'Saves settings, organize rules and ignored items to a file; undo history stays on this device', onclick: async () => {
        downloadFile(JSON.stringify(await buildExport(), null, 2), datedName('ultimate-bookmark-manager-settings', 'json'));
        toast('Settings exported.', 'success');
      } }),
      h('button', { text: 'Import settings…', onclick: () => file.click() }),
      file));
}

function ruleRow(rule, onRemove, error) {
  const field = h('select', { 'aria-label': 'Match against', hidden: rule.kind !== 'filter', onchange: (e) => { rule.field = e.target.value; } },
    ['url', 'title', 'name'].map((v) => h('option', { value: v, text: { url: 'URL', title: 'name', name: 'folder path/name' }[v], selected: (rule.field ?? 'url') === v })));
  const replacement = h('input', { type: 'text', placeholder: 'replace with', title: 'May use $& (the match), $1… (groups), $URL, $NAME (folder path and name) and $TITLE; start with \\L or \\U to lower- or upper-case the result', value: rule.replacement ?? '', hidden: rule.kind !== 'replace', 'aria-label': 'Replacement', oninput: (e) => { rule.replacement = e.target.value; } });
  return h('li', { class: 'rule' },
    h('input', { type: 'checkbox', checked: rule.enabled !== false, 'aria-label': 'Enabled', onchange: (e) => { rule.enabled = e.target.checked; } }),
    h('select', { 'aria-label': 'Rule type', onchange: (e) => {
      rule.kind = e.target.value;
      field.hidden = rule.kind !== 'filter';
      replacement.hidden = rule.kind !== 'replace';
    } }, h('option', { value: 'filter', text: 'Exclude if', selected: rule.kind === 'filter' }), h('option', { value: 'replace', text: 'In URL, replace', selected: rule.kind === 'replace' })),
    field,
    h('input', { type: 'text', class: 'mono grow', placeholder: 'regular expression', value: rule.pattern ?? '', 'aria-label': 'Pattern', oninput: (e) => { rule.pattern = e.target.value; } }),
    h('input', { type: 'text', class: 'mono flags', placeholder: 'flags', value: rule.flags ?? '', 'aria-label': 'Flags', oninput: (e) => { rule.flags = e.target.value; } }),
    replacement,
    h('button', { class: 'small', text: 'Remove', onclick: onRemove }),
    error && h('p', { class: 'error full', text: error }));
}

export default {
  id: 'settings',
  label: 'Settings',

  render(ctx) {
    const saved = JSON.stringify(ctx.state.settings);
    if (draft && JSON.stringify(draft) === draftBase && draftBase !== saved) draft = null;
    if (!draft) {
      draft = structuredClone(ctx.state.settings);
      draftBase = saved;
    }
    const s = draft;
    const save = () => ctx.run(async () => {
      // Organize rules are edited in their own view, so keep whatever is saved for them.
      await saveSettings({ ...s, organize: ctx.state.settings.organize });
      draft = null;
      toast('Settings saved.', 'success');
    });

    const matching = h('fieldset', {}, legend('Duplicate matching', 'Two bookmarks are duplicates when their URLs match after these adjustments'),
      MATCHING.map(([key, label]) => checkLine(s.matching, key, label)));

    const errors = new Map(compileRules(s.duplicateRules).errors.map((e) => [e.index, e.message]));
    const rules = h('ul', { class: 'rules' });
    const drawRules = () => rules.replaceChildren(...s.duplicateRules.map((r, i) => ruleRow(r, () => { s.duplicateRules.splice(i, 1); drawRules(); }, errors.get(i))));
    drawRules();
    const addRule = (rule) => { s.duplicateRules.push({ enabled: true, ...rule }); drawRules(); };
    const rulesBox = h('fieldset', {}, legend('Custom duplicate rules (expert)', 'Exclude rules leave bookmarks out of the duplicate check; Replace rules rewrite a URL before comparing'),
      rules,
      h('div', { class: 'row wrap' },
        h('button', { class: 'small', text: 'Add rule', onclick: () => addRule({ kind: 'filter', field: 'url', pattern: '', flags: 'i' }) }),
        PRESETS.map((p) => h('button', { class: 'small', text: `+ ${p.name}`, onclick: () => addRule(structuredClone(p.rule)) }))));

    const lc = s.linkCheck;
    const defaults = DEFAULT_SETTINGS.linkCheck;
    const linkBox = h('fieldset', {}, legend('Link checking', 'How the broken-link check runs, and domains it never checks'),
      numberField(lc, 'concurrency', 'Parallel requests', defaults.concurrency),
      numberField(lc, 'timeoutSeconds', 'Timeout (seconds)', defaults.timeoutSeconds),
      checkLine(lc, 'skipPrivate', 'Skip addresses on your own network, such as your router, NAS or printer'),
      linesField(lc, 'skipDomains', 'Skip these domains (one per line; subdomains included)', 5),
      checkLine(lc, 'useCookies', 'Send your cookies, so pages you are logged into are checked as you see them (a check then acts as you on each site)'),
      linesField(lc, 'noCookieWords', 'Never send cookies to URLs containing (one per line)', 4),
      checkLine(lc, 'detectLogin', 'List redirects to a login page under Broken links as “may still work”, not as redirects'),
      linesField(lc, 'loginHosts', 'Login services (one per line; subdomains included)', 4));

    const general = h('fieldset', {}, h('legend', { text: 'General' }),
      h('label', { class: 'field' }, 'Folder for moved duplicates (in Other Bookmarks)',
        h('input', { type: 'text', value: s.dupesFolderName, onchange: (e) => { s.dupesFolderName = e.target.value.trim() || DEFAULT_SETTINGS.dupesFolderName; } })),
      numberField(s, 'historyLimit', 'Undo history length', DEFAULT_SETTINGS.historyLimit),
      numberField(s, 'historyDays', 'Forget undo history after (days)', DEFAULT_SETTINGS.historyDays));

    const entries = Object.entries(ctx.state.whitelist);
    const whitelist = h('fieldset', {}, legend(`Ignored items (${entries.length})`, 'Ignored bookmarks and folders are skipped by every check'),
      entries.length
        ? h('ul', { class: 'items' }, entries.map(([id, e]) => h('li', { class: 'item' },
          h('div', { class: 'bm grow' }, h('div', { class: 'bm-title', text: e.title || '(no name)' }),
            e.url && h('div', { class: 'bm-url', text: e.url }),
            e.inside && h('div', { class: 'bm-meta muted', text: 'Folder, with everything inside' })),
          h('div', { class: 'item-actions' }, h('button', { class: 'small', text: 'Stop ignoring', onclick: () => ctx.run(() => removeFromWhitelist([id])) })))))
        : emptyState('Nothing is ignored.'),
      h('div', { class: 'row wrap' }, h('button', { class: 'small', text: 'Ignore a folder…', title: 'Every check skips the folder and everything inside it', onclick: () => ignoreFolder(ctx) })));

    return h('section', { class: 'settings' },
      viewHeader('Settings', 'Matching, sync, link checks and ignored items',
        h('button', { class: 'small', text: 'Discard changes', onclick: () => { draft = null; ctx.render(); } }),
        h('button', { class: 'primary', text: 'Save settings', onclick: save })),
      syncAndBackup(ctx), matching, rulesBox, linkBox, general,
      h('div', { class: 'row end' }, h('button', { class: 'primary', text: 'Save settings', onclick: save })),
      whitelist);
  },
};
