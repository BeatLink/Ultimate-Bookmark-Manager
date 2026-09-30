// Settings: duplicate matching, custom rules, link-check tuning, skip list and whitelist.

import { h, toast } from '../dom.js';
import { viewHeader, emptyState } from '../components.js';
import { saveSettings, removeFromWhitelist } from '../../lib/settings.js';
import { compileRules } from '../../lib/duplicates.js';

const MATCHING = [
  ['ignoreProtocol', 'Treat http and https as the same'],
  ['ignoreWww', 'Treat “www.” and no “www.” as the same'],
  ['ignoreTrailingSlash', 'Ignore a trailing slash'],
  ['ignoreFragment', 'Ignore the part after “#”'],
  ['ignoreQuery', 'Ignore the query string (after “?”)'],
  ['ignoreCase', 'Ignore letter case in the whole address'],
];

const PRESETS = [
  { name: 'Strip tracking parameters', rule: { kind: 'replace', pattern: '([?&])(utm_[^=&#]*|fbclid|gclid|mc_eid)=[^&#]*', flags: 'i', replacement: '$1' } },
  { name: 'Skip bookmarklets', rule: { kind: 'filter', field: 'url', pattern: '^javascript:', flags: 'i' } },
  { name: 'Skip a folder by name', rule: { kind: 'filter', field: 'name', pattern: '^Bookmarks Toolbar/Keep/', flags: '' } },
];

function ruleRow(rule, onRemove, error) {
  const field = h('select', { 'aria-label': 'Match against', hidden: rule.kind !== 'filter', onchange: (e) => { rule.field = e.target.value; } },
    ['url', 'title', 'name'].map((v) => h('option', { value: v, text: { url: 'address', title: 'name', name: 'folder path/name' }[v], selected: (rule.field ?? 'url') === v })));
  const replacement = h('input', { type: 'text', placeholder: 'replace with', value: rule.replacement ?? '', hidden: rule.kind !== 'replace', 'aria-label': 'Replacement', oninput: (e) => { rule.replacement = e.target.value; } });
  return h('li', { class: 'rule' },
    h('input', { type: 'checkbox', checked: rule.enabled !== false, 'aria-label': 'Enabled', onchange: (e) => { rule.enabled = e.target.checked; } }),
    h('select', { 'aria-label': 'Rule type', onchange: (e) => {
      rule.kind = e.target.value;
      field.hidden = rule.kind !== 'filter';
      replacement.hidden = rule.kind !== 'replace';
    } }, h('option', { value: 'filter', text: 'Exclude if', selected: rule.kind === 'filter' }), h('option', { value: 'replace', text: 'In address, replace', selected: rule.kind === 'replace' })),
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
    const s = structuredClone(ctx.state.settings);
    const save = () => ctx.run(async () => {
      await saveSettings(s);
      toast('Settings saved.', 'success');
    });

    const matching = h('fieldset', {}, h('legend', { text: 'Duplicate matching' }),
      h('p', { class: 'muted', text: 'Two bookmarks are duplicates when their addresses match after these adjustments.' }),
      MATCHING.map(([key, label]) => h('label', { class: 'check-line' },
        h('input', { type: 'checkbox', checked: s.matching[key], onchange: (e) => { s.matching[key] = e.target.checked; } }), label)));

    const errors = new Map(compileRules(s.rules).errors.map((e) => [e.index, e.message]));
    const rules = h('ul', { class: 'rules' });
    const drawRules = () => rules.replaceChildren(...s.rules.map((r, i) => ruleRow(r, () => { s.rules.splice(i, 1); drawRules(); }, errors.get(i))));
    drawRules();
    const addRule = (rule) => { s.rules.push({ enabled: true, ...rule }); drawRules(); };
    const rulesBox = h('fieldset', {}, h('legend', { text: 'Custom duplicate rules (expert)' }),
      h('p', { class: 'muted' },
        '“Exclude” rules leave matching bookmarks out of the duplicate check. “Replace” rules rewrite the address before comparing (the bookmark itself is not changed). ',
        'Replacements may use ', h('code', { text: '$&' }), ', ', h('code', { text: '$1' }), '…, ', h('code', { text: '$URL' }), ', ', h('code', { text: '$NAME' }), ' (folder path and name), ',
        h('code', { text: '$TITLE' }), ', and may start with ', h('code', { text: '\\L' }), ' or ', h('code', { text: '\\U' }), ' to lower- or upper-case the result.'),
      rules,
      h('div', { class: 'row wrap' },
        h('button', { class: 'small', text: 'Add rule', onclick: () => addRule({ kind: 'filter', field: 'url', pattern: '', flags: 'i' }) }),
        PRESETS.map((p) => h('button', { class: 'small', text: `+ ${p.name}`, onclick: () => addRule(structuredClone(p.rule)) }))));

    const lc = s.linkCheck;
    const linkBox = h('fieldset', {}, h('legend', { text: 'Link checking' }),
      h('label', { class: 'field' }, 'Parallel requests',
        h('input', { type: 'number', min: 1, max: 32, value: String(lc.concurrency), onchange: (e) => { lc.concurrency = Math.min(32, Math.max(1, Number(e.target.value) || 6)); } })),
      h('label', { class: 'field' }, 'Timeout (seconds)',
        h('input', { type: 'number', min: 3, max: 120, value: String(lc.timeoutSeconds), onchange: (e) => { lc.timeoutSeconds = Math.min(120, Math.max(3, Number(e.target.value) || 15)); } })),
      h('label', { class: 'field block' }, 'Skip these domains (one per line; subdomains included)',
        h('textarea', { rows: 5, class: 'mono', onchange: (e) => { lc.skipDomains = e.target.value.split('\n').map((d) => d.trim()).filter(Boolean); } }, lc.skipDomains.join('\n'))));

    const general = h('fieldset', {}, h('legend', { text: 'General' }),
      h('label', { class: 'field' }, 'Folder for moved duplicates (in Other Bookmarks)',
        h('input', { type: 'text', value: s.dupesFolderName, onchange: (e) => { s.dupesFolderName = e.target.value.trim() || 'Dupes'; } })),
      h('label', { class: 'field' }, 'Undo history length',
        h('input', { type: 'number', min: 1, max: 500, value: String(s.historyLimit), onchange: (e) => { s.historyLimit = Math.min(500, Math.max(1, Number(e.target.value) || 50)); } })));

    const entries = Object.entries(ctx.state.whitelist);
    const whitelist = h('fieldset', {}, h('legend', { text: `Ignored items (${entries.length})` }),
      h('p', { class: 'muted', text: 'Ignored bookmarks and folders are skipped by every check.' }),
      entries.length
        ? h('ul', { class: 'items' }, entries.map(([id, e]) => h('li', { class: 'item' },
          h('div', { class: 'bm grow' }, h('div', { class: 'bm-title', text: e.title || '(no name)' }), e.url && h('div', { class: 'bm-url', text: e.url })),
          h('div', { class: 'item-actions' }, h('button', { class: 'small', text: 'Stop ignoring', onclick: () => ctx.run(() => removeFromWhitelist([id])) })))))
        : emptyState('Nothing is ignored.'));

    return h('section', { class: 'settings' },
      viewHeader('Settings', null, h('button', { class: 'primary', text: 'Save settings', onclick: save })),
      matching, rulesBox, linkBox, general,
      h('div', { class: 'row end' }, h('button', { class: 'primary', text: 'Save settings', onclick: save })),
      whitelist);
  },
};
