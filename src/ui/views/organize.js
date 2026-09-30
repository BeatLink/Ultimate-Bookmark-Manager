// Organize rules: edit rules that file bookmarks into folders, preview the moves, then apply them.

import { h, Selection, toast, confirmDialog } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectAllToggle, bookmarkInfo, row, tagInput, pickFolder } from '../components.js';
import { saveSettings } from '../../lib/settings.js';
import { OPERATORS, FIELDS, newRule, newCondition, keywords, duplicateRule, planMoves, ruleMatches } from '../../lib/organize.js';

// Unsaved edits live here so they survive the re-render that follows any other action.
let draft = null;
// The saved rules the draft started from; an untouched draft follows the saved rules when they change.
let draftBase = null;
// Moves the user unticked in the preview, so a refresh or an edited rule does not tick them again.
const unticked = new Set();

const rootFolders = (ctx) => ctx.state.root.children.map((c) => ({ id: c.id, title: c.title }));

export function plan(ctx, rules) {
  return planMoves(ctx.state.flat, rules, rootFolders(ctx), ctx.ignoredIds());
}

function select(options, value, onchange, label) {
  return h('select', { 'aria-label': label, onchange: (e) => onchange(e.target.value) },
    Object.entries(options).map(([v, text]) => h('option', { value: v, text, selected: v === value })));
}

const PLACEHOLDERS = { regex: 'Type a pattern, press Enter', domain: 'example.com, press Enter' };

function conditionRow(cond, onRemove, changed) {
  cond.values = keywords(cond);
  delete cond.value;
  const field = select(FIELDS, cond.field, (v) => { cond.field = v; changed(); }, 'Field');
  field.hidden = cond.op === 'domain';
  const makeTags = () => tagInput({
    values: cond.values,
    onchange: changed,
    commaSeparates: cond.op !== 'regex',
    mono: cond.op === 'regex',
    placeholder: PLACEHOLDERS[cond.op] ?? 'Type a keyword, press Enter',
    label: 'Keywords',
  });
  let tags = makeTags();
  return h('li', { class: 'condition' },
    field,
    select(OPERATORS, cond.op, (v) => {
      cond.op = v;
      field.hidden = v === 'domain';
      const next = makeTags();
      tags.replaceWith(next);
      tags = next;
      changed();
    }, 'Operator'),
    tags,
    h('label', { class: 'check-line small', title: 'Match upper and lower case exactly' },
      h('input', { type: 'checkbox', checked: cond.caseSensitive, onchange: (e) => { cond.caseSensitive = e.target.checked; changed(); } }), 'Aa'),
    h('button', { class: 'small', text: '×', title: 'Remove condition', 'aria-label': 'Remove condition', onclick: onRemove }));
}

// A button showing the rule's target folder that opens the folder picker.
function targetPicker(ctx, rule, changed) {
  const label = () => rule.target ? rule.target.split('/').join(' › ') : 'Choose folder…';
  const button = h('button', { class: `folder-button${rule.target ? '' : ' unset'}`, type: 'button', 'aria-label': 'Target folder', onclick: async () => {
    const picked = await pickFolder(ctx.state.root, rule.target);
    if (picked === null) return;
    rule.target = picked;
    button.replaceChildren(h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), label());
    button.classList.toggle('unset', !picked);
    changed();
  } }, h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), label());
  return button;
}

function ruleCard(ctx, rule, i, rules, redraw, changed, info) {
  const move = (delta) => {
    rules.splice(i, 1);
    rules.splice(i + delta, 0, rule);
    redraw();
  };
  const conds = h('ul', { class: 'conditions' });
  const drawConds = () => conds.replaceChildren(...rule.conditions.map((c, j) =>
    conditionRow(c, () => { rule.conditions.splice(j, 1); drawConds(); changed(); }, changed)));
  drawConds();

  return h('li', { class: `rule-card${rule.enabled === false ? ' disabled' : ''}` },
    h('div', { class: 'row wrap' },
      h('input', { type: 'checkbox', checked: rule.enabled !== false, 'aria-label': 'Rule enabled', onchange: (e) => { rule.enabled = e.target.checked; redraw(); } }),
      h('span', { class: 'order', text: i + 1, title: 'Rules are tried in this order; the first match wins' }),
      h('input', { type: 'text', class: 'grow rule-name', value: rule.name, placeholder: 'Rule name (optional)', 'aria-label': 'Rule name', oninput: (e) => { rule.name = e.target.value; changed(); } }),
      h('button', { class: 'small', text: '↑', title: 'Move up', 'aria-label': 'Move rule up', disabled: i === 0, onclick: () => move(-1) }),
      h('button', { class: 'small', text: '↓', title: 'Move down', 'aria-label': 'Move rule down', disabled: i === rules.length - 1, onclick: () => move(1) }),
      h('button', { class: 'small', text: 'Duplicate', title: 'Add an editable copy of this rule below it', onclick: (e) => {
        const list = e.currentTarget.closest('.rule-list');
        rules.splice(i + 1, 0, duplicateRule(rule));
        redraw();
        const name = list.children[i + 1]?.querySelector('.rule-name');
        name?.scrollIntoView?.({ block: 'nearest' });
        name?.focus();
        name?.select();
      } }),
      h('button', { class: 'small danger', text: 'Delete', onclick: () => { rules.splice(i, 1); redraw(); } })),
    h('div', { class: 'row wrap' }, 'When', select({ any: 'any', all: 'all' }, rule.match, (v) => { rule.match = v; changed(); }, 'Match'), 'of these are true:'),
    conds,
    h('button', { class: 'small', text: '+ Condition', onclick: () => { rule.conditions.push(newCondition()); drawConds(); conds.lastElementChild?.querySelector('.tag-input input')?.focus(); } }),
    h('div', { class: 'row wrap target' }, 'Move to folder', targetPicker(ctx, rule, changed)),
    info);
}

export default {
  id: 'organize',
  label: 'Organize',
  badge: (ctx) => ctx.memo('organize', () => plan(ctx, ctx.state.settings.organize.rules)).moves.length,

  render(ctx) {
    const saved = JSON.stringify(ctx.state.settings.organize);
    if (draft && JSON.stringify(draft) === draftBase && draftBase !== saved) draft = null;
    if (!draft) {
      draft = structuredClone(ctx.state.settings.organize);
      draftBase = saved;
    }
    const rules = draft.rules;
    const section = h('section', { class: 'organize' });
    const rulesList = h('ol', { class: 'rule-list' });
    const previewBox = h('div');
    const dirtyNote = h('span', { class: 'muted small' });

    const isDirty = () => JSON.stringify(draft) !== JSON.stringify(ctx.state.settings.organize);
    const save = (message = 'Rules saved.') => ctx.run(async () => {
      await saveSettings({ ...ctx.state.settings, organize: draft });
      draft = null;
      if (message) toast(message, 'success');
    });

    let previewTimer;
    const changed = () => {
      dirtyNote.textContent = isDirty() ? 'Unsaved changes' : '';
      clearTimeout(previewTimer);
      previewTimer = setTimeout(drawPreview, 300);
    };

    // Cards are rebuilt only when rules are added, removed or reordered; typing just refreshes this text.
    const infos = new Map();
    const drawRules = () => {
      infos.clear();
      rulesList.replaceChildren(...rules.map((r, i) => {
        const info = h('div', { class: 'rule-info' });
        infos.set(r.id, info);
        return ruleCard(ctx, r, i, rules, redraw, changed, info);
      }));
    };
    const refreshInfo = (moves, problems) => {
      for (const r of rules) {
        const info = infos.get(r.id);
        if (!info) continue;
        const issues = problems.get(r.id);
        if (issues) {
          info.replaceChildren(...issues.map((p) => h('p', { class: 'error small', text: p })));
          continue;
        }
        const matched = ctx.state.flat.filter((b) => b.type === 'bookmark' && ruleMatches(r, b)).length;
        const moving = moves.filter((m) => m.ruleId === r.id).length;
        info.replaceChildren(h('p', { class: 'muted small', text: `Matches ${matched} bookmark(s); ${moving} would move. The rest are already in place or taken by an earlier rule.` }));
      }
    };

    const drawPreview = () => {
      const { moves, problems } = plan(ctx, rules);
      refreshInfo(moves, problems);
      if (!rules.length) return previewBox.replaceChildren(emptyState('No rules yet. Add one to start organizing.'));
      if (!moves.length) return previewBox.replaceChildren(h('h2', { text: 'Preview' }), emptyState('Nothing to move: every matching bookmark is already in its folder.'));

      const sel = new Selection();
      sel.set(moves.map((m) => m.bookmark.id).filter((id) => !unticked.has(id)), true);
      sel.onChange(() => {
        for (const m of moves) sel.has(m.bookmark.id) ? unticked.delete(m.bookmark.id) : unticked.add(m.bookmark.id);
      });
      const byTarget = new Map();
      for (const m of moves) {
        const key = m.target.path.join('/');
        if (!byTarget.has(key)) byTarget.set(key, []);
        byTarget.get(key).push(m);
      }
      const apply = h('button', { class: 'primary', onclick: async () => {
        const chosen = moves.filter((m) => sel.has(m.bookmark.id));
        if (!(await confirmDialog(`Move ${chosen.length} bookmark(s) into their rule folders? Missing folders are created. You can undo this from the history.${isDirty() ? ' Your rule changes will be saved too.' : ''}`, 'Move', false))) return;
        await ctx.run(async () => {
          if (isDirty()) {
            await saveSettings({ ...ctx.state.settings, organize: draft });
            draft = null;
          }
          await ctx.actions.organize(chosen.map((m) => ({ id: m.bookmark.id, target: m.target })));
          ctx.done(`Moved ${chosen.length} bookmark(s).`);
        });
      } });
      const updateApply = () => {
        apply.textContent = `Move ${sel.size} selected`;
        apply.disabled = sel.size === 0;
      };
      sel.onChange(updateApply);
      updateApply();

      const list = h('div', { class: 'groups' }, [...byTarget].map(([path, group]) => h('section', { class: 'group' },
        h('h2', { class: 'group-title sticky' }, h('span', { text: `→ ${path.replaceAll('/', ' › ')} — ${group.length}` }), selectAllToggle(sel, group.map((m) => m.bookmark.id), 'Select group')),
        h('ul', { class: 'items' }, group.map((m) => row(sel, m.bookmark.id, bookmarkInfo(m.bookmark, ctx, {
          editable: false,
          meta: h('span', { text: `Rule: ${m.ruleName || `#${rules.findIndex((r) => r.id === m.ruleId) + 1}`}` }),
        })))))));
      bindCheckboxes(list, sel);
      previewBox.replaceChildren(
        h('div', { class: 'selection-bar' },
          h('div', { class: 'row wrap' }, h('h2', { text: `Preview: ${moves.length} bookmark(s) to move` })),
          h('div', { class: 'row wrap end' }, selectAllToggle(sel, moves.map((m) => m.bookmark.id)), apply)),
        list);
    };

    const redraw = () => {
      drawRules();
      changed();
    };

    section.append(
      viewHeader('Organize', 'Rules that file bookmarks into folders by words in their title or address. Rules are tried from the top and the first match wins. Bookmarks already anywhere inside the target folder stay where they are.',
        dirtyNote,
        h('button', { class: 'small', text: 'Discard changes', onclick: () => { draft = null; ctx.render(); } }),
        h('button', { class: 'primary', text: 'Save rules', onclick: () => save() })),
      h('label', { class: 'check-line' },
        h('input', { type: 'checkbox', checked: draft.autoApply, onchange: (e) => { draft.autoApply = e.target.checked; changed(); } }),
        'Organize new bookmarks automatically (a few seconds after they are added; skipped if you pick a folder yourself or many arrive at once, as during an import or sync)'),
      rulesList,
      h('div', { class: 'row wrap' },
        h('button', { text: '+ Add rule', onclick: () => { rules.push(newRule()); redraw(); rulesList.lastElementChild?.querySelector('.tag-input input')?.focus(); } })),
      previewBox);

    drawRules();
    drawPreview();
    dirtyNote.textContent = isDirty() ? 'Unsaved changes' : '';
    return section;
  },
};
