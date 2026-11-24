// Rules: edit rules that act on the bookmarks matching their conditions, preview what they would do, then apply it.

import { h, Selection, toast, confirmDialog, promptDialog } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectionBar, selectAllToggle, bookmarkInfo, row, pagedList, pickFolder, pickRule, helpLink, actionMenu } from '../components.js';
import { mountQueryEditor } from '../query-editor.js';
import { ProgressJob } from '../progress.js';
import { askAllSites } from '../permissions.js';
import { saveSettings } from '../../lib/settings.js';
import { ACTIONS, LOOK_IN, newRule, newAction, duplicateRule, moveToNewRule, mergeRules, reorder, refreshMovePaths, folderPaths, ruleName, describeRule, folderLabel } from '../../lib/rules.js';
import { hasEffect } from '../../lib/rule-plan.js';
import { loadPageDetails } from '../../lib/page-titles.js';
import { fetchOptions } from '../../lib/linkcheck.js';
import { groupBy } from '../../lib/group.js';
import * as scans from '../scans.js';

// What the page remembers between renders, so a refresh after any other action does not lose the user's place.
const state = {
  // Unsaved edits, and the saved rules they started from; an untouched draft follows the saved rules when they change.
  draft: null,
  draftBase: null,
  // Changes the user unticked in the preview.
  unticked: new Set(),
  // Rules shown open; saved rules start closed, while new and duplicated ones open for editing.
  expanded: new Set(),
  query: '',
  unmatchedOpen: false,
};

// Each open rule's query editor, taken down when the list is redrawn.
const editors = new Map();

// The preview is redrawn this long after the last edit.
const PREVIEW_DELAY_MS = 300;

const PART_NAMES = { title: 'title', url: 'URL', host: 'site name', path: 'path', query: 'query string', fragment: 'part after #' };

// What each action that needs no settings does, shown in place of its settings.
const ACTION_NOTES = {
  pageTitle: 'Uses the title the last link check found, or reads the page when applied.',
  redirect: 'Uses the address the last link check found it redirects to, or reads the page when applied.',
  ignore: 'Every check, and these rules, skip it from then on.',
  delete: 'Removes the bookmark; you can undo this from the history.',
};

// Reading pages for title and redirect actions, kept here so switching views does not lose it.
const job = new ProgressJob((done, total) => `Reading pages: ${done} of ${total}`);

const quoted = (r) => `“${ruleName(r)}”`;

// "“ccna” in title, “youtube.com” in URL" for a rule's match explanation.
function matchedText(why) {
  return why.terms.map((t) => `“${t.value}” in ${t.on.map((o) => PART_NAMES[o] ?? o).join(' and ')}`).join(', ');
}

// Sets a toggle button's state and the labels that go with it.
function setToggle(button, open, { collapse, expand }) {
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', open ? collapse : expand);
  button.title = open ? collapse : expand;
}

// The rule's conditions in a react-querybuilder editor.
function queryEditor(ctx, rule, changed, moveToNewRule) {
  const box = h('div', { class: 'query-box' });
  editors.get(rule.id)?.();
  editors.set(rule.id, mountQueryEditor(box, rule.query, (query) => { rule.query = query; changed(); }, { root: ctx.state.root, moveToNewRule }));
  return box;
}

// One labelled row of a rule's editor; the labels share a column, so every row's controls start at the same place.
function field(label, ...controls) {
  return h('div', { class: 'field-row' }, h('span', { class: 'field-label' }, label), h('div', { class: 'field-value' }, ...controls));
}

// The settings of one action: a folder, a search and its replacement, or a note on what it does.
function actionSettings(ctx, action, { redraw, changed }) {
  const set = (key, value) => {
    action[key] = value;
    changed();
  };
  if (action.type === 'move') {
    const pick = async () => {
      const key = await pickFolder(ctx.state.root, action.path, { heading: 'Folder to move to', verb: 'Move to' });
      if (!key) return;
      // The folder is remembered by id too when it exists, so renaming or moving it elsewhere keeps the rule pointing at it.
      const folder = ctx.state.flat.find((n) => n.type === 'folder' && [...n.path, n.title].join('/') === key);
      action.path = key;
      action.folderId = folder?.id ?? '';
      redraw();
    };
    const current = folderPaths(ctx.state.flat).get(action.folderId)?.join('/') ?? action.path;
    return h('div', { class: 'action-settings' },
      h('button', { class: `rule-button folder-button${current ? '' : ' unset'}`, type: 'button', 'aria-label': 'Folder to move to', onclick: pick },
        h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), current ? folderLabel(current) : 'Choose a folder…'));
  }
  if (action.type === 'replace') {
    const text = (key, label, placeholder) => h('input', { type: 'text', class: 'grow', value: action[key], placeholder, spellcheck: 'false', 'aria-label': label,
      oninput: (e) => set(key, e.target.value) });
    const check = (key, label, title) => h('label', { class: 'check-line', title },
      h('input', { type: 'checkbox', checked: action[key], onchange: (e) => set(key, e.target.checked) }), label);
    return h('div', { class: 'action-settings' },
      h('div', { class: 'row' }, text('find', 'Find', 'Text to find'), text('replace', 'Replace with', 'Replace with (empty deletes it)')),
      h('div', { class: 'row wrap' },
        h('label', { class: 'row' }, 'In',
          h('select', { 'aria-label': 'Look in', onchange: (e) => set('field', e.target.value) },
            Object.entries(LOOK_IN).map(([value, label]) => h('option', { value, text: label, selected: action.field === value })))),
        check('caseSensitive', 'Match case'),
        check('regex', 'Regex', 'Find with a regular expression; the replacement can use $1, $& and $<name>')));
  }
  return h('div', { class: 'action-settings' }, h('span', { class: 'muted small', text: ACTION_NOTES[action.type] }));
}

// The rule's actions, run in order on each bookmark it matches, each with its settings and buttons to move or remove it.
function actionsEditor(ctx, rule, handlers) {
  const { redraw } = handlers;
  const shift = (index, by) => {
    rule.actions = reorder(rule.actions, index, index + by);
    redraw();
  };
  const actionRow = (action, index) => h('li', { class: 'action-row' },
    h('select', { class: 'action-type', 'aria-label': 'Action', onchange: (e) => {
      rule.actions[index] = newAction(e.target.value);
      redraw();
    } }, Object.entries(ACTIONS).map(([value, text]) => h('option', { value, text, selected: value === action.type }))),
    actionSettings(ctx, action, handlers),
    h('div', { class: 'rule-actions' },
      h('button', { class: 'small', text: '↑', title: 'Run earlier', 'aria-label': 'Move action up', disabled: index === 0, onclick: () => shift(index, -1) }),
      h('button', { class: 'small', text: '↓', title: 'Run later', 'aria-label': 'Move action down', disabled: index === rule.actions.length - 1, onclick: () => shift(index, 1) }),
      h('button', { class: 'small', text: '×', title: 'Remove', 'aria-label': 'Remove action', onclick: () => {
        rule.actions.splice(index, 1);
        redraw();
      } })));
  return [
    h('ol', { class: 'action-rows' }, rule.actions.map(actionRow)),
    h('button', { class: 'small', text: '+ Action', onclick: () => {
      rule.actions.push(newAction());
      redraw();
    } }),
  ];
}

// A menu item that picks a rule to merge into this one; the chosen rule's conditions join this rule's and it is removed.
function mergeAction(rule, rules, redraw) {
  const others = rules.filter((r) => r !== rule);
  return { label: 'Merge…', title: 'Merge another rule into this one', disabled: !others.length, run: async () => {
    const entries = others.map((r) => ({ id: r.id, label: ruleName(r), detail: describeRule(r) }));
    const id = await pickRule(entries, { heading: `Merge into ${quoted(rule)}`, confirm: 'Merge this rule' });
    const other = others.find((r) => r.id === id);
    if (!other) return;
    if (!(await confirmDialog(`Merge ${quoted(other)} into ${quoted(rule)}? This rule will match whatever either of them matched and keep its own actions, and ${quoted(other)} is removed.`, 'Merge', false))) return;
    rules.splice(0, rules.length, ...mergeRules(rules, rule.id, other.id));
    state.expanded.add(rule.id);
    redraw();
  } };
}

// A rule as a one-line summary row that expands into its editor; `parts` receives the bits refreshed while editing.
function ruleCard(ctx, rule, rules, handlers, parts) {
  const { redraw, changed, revealRule } = handlers;
  const index = rules.indexOf(rule);
  const bodyId = `rule-body-${rule.id}`;
  const isOpen = state.expanded.has(rule.id);
  const body = h('div', { class: 'rule-body', id: bodyId, hidden: !isOpen });
  const check = (key, label, title, fallback) => h('label', { class: 'field-row', title }, h('span', { class: 'field-label', text: label }), h('span', { class: 'field-value' },
    h('input', { type: 'checkbox', checked: rule[key] ?? fallback, 'aria-label': label, onchange: (e) => { rule[key] = e.target.checked; redraw(); } })));
  // The editor is only built the first time the rule is opened.
  const fillBody = () => body.append(
    check('enabled', 'Enabled', null, true),
    check('autoRun', 'Run on new bookmarks', 'A few seconds after each is added; skipped if you pick a folder yourself, or when many arrive at once as during an import or sync', false),
    field('Conditions', queryEditor(ctx, rule, changed, (itemId) => {
      const moved = moveToNewRule(rules, rule.id, itemId);
      if (!moved) return;
      rules.splice(0, rules.length, ...moved.rules);
      state.expanded.add(moved.part.id);
      // Redrawn after the click is handled, as the redraw takes down the editor the click came from.
      setTimeout(redraw);
    })),
    field([h('span', { text: 'Actions ' }), helpLink('Run in order on each bookmark the rule matches, after the actions of the rules above it', 'rules')], ...actionsEditor(ctx, rule, handlers)),
    field('', parts.info));
  if (isOpen) fillBody();

  // The chevron and the name both open and close the rule.
  const toggleLabels = { collapse: 'Collapse rule', expand: 'Edit rule' };
  const toggle = h('button', {
    class: 'rule-toggle', type: 'button', 'aria-controls': bodyId,
    onclick: () => {
      const open = body.hidden;
      if (open && !body.childElementCount) fillBody();
      body.hidden = !open;
      open ? state.expanded.add(rule.id) : state.expanded.delete(rule.id);
      setToggle(toggle, open, toggleLabels);
      card.classList.toggle('open', open);
    },
  }, h('span', { class: 'chevron', 'aria-hidden': 'true' }));
  setToggle(toggle, isOpen, toggleLabels);
  const name = h('span', { class: `rule-name${rule.name ? '' : ' unnamed'}`, text: ruleName(rule), title: describeRule(rule), onclick: () => toggle.click() });
  const shift = (by) => {
    rules.splice(0, rules.length, ...reorder(rules, index, index + by));
    redraw();
    revealRule(rule.id);
  };
  const menu = actionMenu([
    { label: 'Rename…', run: async () => {
      const value = await promptDialog('Rule name', 'Rename', rule.name ?? '');
      if (value === null || value === rule.name) return;
      rule.name = value;
      redraw();
    } },
    { label: 'Duplicate', title: 'Add an editable copy of this rule', run: () => {
      const copy = duplicateRule(rule);
      state.expanded.add(copy.id);
      rules.splice(index + 1, 0, copy);
      redraw();
      revealRule(copy.id);
    } },
    { label: 'Move up', title: 'Run this rule earlier', disabled: index === 0, run: () => shift(-1) },
    { label: 'Move down', title: 'Run this rule later', disabled: index === rules.length - 1, run: () => shift(1) },
    mergeAction(rule, rules, redraw),
    null,
    { label: 'Delete', danger: true, run: () => {
      state.expanded.delete(rule.id);
      rules.splice(index, 1);
      redraw();
    } },
  ], 'Rule actions');

  const card = h('li', { class: `rule-card${rule.enabled === false ? ' disabled' : ''}${isOpen ? ' open' : ''}`, 'data-rule': rule.id },
    h('div', { class: 'rule-head' },
      parts.handle,
      toggle,
      h('span', { class: 'rule-number muted', text: `${index + 1}.` }),
      name,
      rule.autoRun && h('span', { class: 'score-chip', text: 'new bookmarks', title: 'Also runs on each new bookmark' }),
      parts.badge,
      menu),
    body);
  return card;
}

// What a bookmark's name and URL become, when a rule edits them.
function becomes(change) {
  const { edits } = change;
  if (!('title' in edits) && !('url' in edits)) return null;
  return h('div', { class: 'replaced' },
    h('div', { class: 'muted', text: 'Becomes' }),
    'title' in edits && h('div', { class: 'bm-title' }, edits.title || h('span', { class: 'untitled', text: '(no name)' })),
    'url' in edits && h('div', { class: 'bm-url', text: edits.url }));
}

// The steps the rules would take on one bookmark, each with the rule it comes from.
function stepList(change) {
  return h('ol', { class: 'rule-steps small' }, change.steps.map((s) => h('li', { class: s.action === 'delete' ? 'error' : s.waiting ? 'muted' : '' },
    h('strong', { text: s.ruleName || 'Unnamed rule' }), `: ${s.text}`)));
}

// A group of preview rows under a sticky heading, shown a page at a time.
function previewGroup(key, heading, items, make) {
  const list = h('ul', { class: 'items' });
  const more = pagedList(key, list, items, make);
  return h('section', { class: 'group' }, h('h2', { class: 'group-title sticky' }, heading), list, more);
}

// Reads the pages that title and redirect actions need, marking every one as read so a failed page is not waited on again.
async function readPages(ctx, bookmarks) {
  const signal = job.start(bookmarks.length);
  try {
    const read = await loadPageDetails(bookmarks, { ...fetchOptions(ctx.state.settings.linkCheck), signal, onProgress: (done) => job.progress(done) });
    return new Map(bookmarks.map((b) => [b.id, { ...read.get(b.id), url: b.url, read: true }]));
  } finally {
    job.finish();
  }
}

export default {
  id: 'rules',
  label: 'Rules',
  badge: (ctx) => scans.rulesPlan(ctx).changes.length,

  render(ctx) {
    const saved = JSON.stringify(ctx.state.settings.organize);
    const untouched = state.draft && JSON.stringify(state.draft) === state.draftBase;
    // An untouched draft is dropped when the saved rules changed underneath it, say through sync or an undo.
    if (untouched && state.draftBase !== saved) state.draft = null;
    if (!state.draft) {
      state.draft = structuredClone(ctx.state.settings.organize);
      state.draftBase = saved;
    }
    const draft = state.draft;
    const rules = draft.rules;
    const section = h('section', { class: 'rules-page' });
    const listBox = h('div', { class: 'rule-list-box' });
    const previewBox = h('div');
    const unmatchedBox = h('div');
    const dirtyNote = h('span', { class: 'muted small' });

    const isDirty = () => JSON.stringify(draft) !== JSON.stringify(ctx.state.settings.organize);
    // Each move's path is brought up to date from its folder on saving, so it still finds the folder on a device where the id differs.
    const persistDraft = async () => {
      await saveSettings({ ...ctx.state.settings, organize: { ...draft, rules: refreshMovePaths(draft.rules, folderPaths(ctx.state.flat)) } });
      state.draft = null;
    };
    const save = () => ctx.run(async () => {
      await persistDraft();
      toast('Rules saved.', 'success');
    });

    let previewTimer;
    const changed = () => {
      dirtyNote.textContent = isDirty() ? 'Unsaved changes' : '';
      clearTimeout(previewTimer);
      previewTimer = setTimeout(drawPreview, PREVIEW_DELAY_MS);
    };

    const cardParts = new Map();
    const revealRule = (id) => listBox.querySelector(`[data-rule="${id}"]`)?.scrollIntoView?.({ block: 'nearest' });

    // The rule being dragged, dropped before or after another to change the order rules run in.
    let dragging = null;
    const clearDrag = () => {
      dragging = null;
      for (const el of listBox.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after');
    };
    const ruleHandle = (r) => h('span', { class: 'rule-drag', draggable: 'true', role: 'img', 'aria-label': 'Drag handle', title: 'Drag to change the order rules run in', text: '⠿',
      ondragstart: (e) => {
        dragging = r;
        e.dataTransfer.setData('application/x-bookmark-rule', r.id);
        e.dataTransfer.effectAllowed = 'move';
        const card = e.currentTarget.closest('.rule-card');
        if (card) e.dataTransfer.setDragImage(card, 12, 12);
      },
      ondragend: clearDrag });
    const dropProps = (r) => ({
      ondragover: (e) => {
        if (!dragging || dragging === r) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const box = e.currentTarget.getBoundingClientRect();
        const after = e.clientY > box.top + box.height / 2;
        e.currentTarget.classList.toggle('drop-after', after);
        e.currentTarget.classList.toggle('drop-before', !after);
      },
      ondragleave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drop-before', 'drop-after');
      },
      ondrop: (e) => {
        if (!dragging || dragging === r) return;
        e.preventDefault();
        const after = e.currentTarget.classList.contains('drop-after');
        const from = rules.indexOf(dragging);
        const moved = dragging;
        clearDrag();
        let to = rules.indexOf(r) + (after ? 1 : 0);
        if (from < to) to--;
        rules.splice(0, rules.length, ...reorder(rules, from, to));
        redraw();
        revealRule(moved.id);
      },
    });
    const card = (r) => {
      const parts = { handle: ruleHandle(r), info: h('div', { class: 'rule-info' }), badge: h('span', { class: 'rule-badge' }) };
      cardParts.set(r.id, parts);
      const el = ruleCard(ctx, r, rules, { redraw, changed, revealRule }, parts);
      for (const [event, listener] of Object.entries(dropProps(r))) el.addEventListener(event.slice(2), listener);
      return el;
    };

    // The whole list is rebuilt when rules are added, removed or moved; typing only refreshes the cards' text.
    const drawList = () => {
      for (const unmount of editors.values()) unmount();
      editors.clear();
      cardParts.clear();
      const q = state.query.trim().toLowerCase();
      const shown = rules.filter((r) => !q || ruleName(r).toLowerCase().includes(q) || describeRule(r).toLowerCase().includes(q));
      if (!rules.length) return listBox.replaceChildren(emptyState('No rules yet. Use “+ Rule” to add one.'));
      listBox.replaceChildren(shown.length ? h('ol', { class: 'rule-list' }, shown.map(card)) : emptyState('No rules match.'));
    };

    // A rule card's badge and info line from the plan.
    const paintCard = (r, parts, { problems, matched, acting }) => {
      const issues = problems.get(r.id);
      if (issues) {
        parts.info.replaceChildren(...issues.map((x) => h('p', { class: 'error small', text: x })));
        parts.badge.textContent = 'Needs attention';
        parts.badge.className = 'rule-badge error';
        parts.badge.title = issues.join(' ');
        return;
      }
      const rest = matched > acting ? ` The rest are already as it would leave them, or a rule above deletes them.` : '';
      parts.info.replaceChildren(h('p', { class: 'muted small', text: `Matches ${matched} bookmark(s) and would change ${acting}.${rest}` }));
      parts.badge.textContent = r.enabled === false ? 'Off' : `${acting} to change`;
      parts.badge.className = `rule-badge${acting && r.enabled !== false ? ' active' : ''}`;
      parts.badge.title = `Matches ${matched}, would change ${acting}`;
    };

    // Refreshes the badge and notes on every rule card from the current plan.
    const paintStatus = (plan = scans.planFor(ctx, rules)) => {
      for (const r of rules) {
        const parts = cardParts.get(r.id);
        if (parts) paintCard(r, parts, { problems: plan.problems, matched: plan.matches.get(r.id) ?? 0, acting: plan.acting.get(r.id) ?? 0 });
      }
    };

    // Bookmarks no rule matches, grouped by the folder they are in; rows are built only once the list is opened.
    const drawUnmatched = (unmatched) => {
      if (!rules.length || !unmatched.length) return unmatchedBox.replaceChildren();
      const byFolder = [...groupBy(unmatched, (b) => (b.path ?? []).join(' › '))].sort(([a], [b]) => a.localeCompare(b));
      const item = (b) => h('li', { class: 'item' }, bookmarkInfo(b, ctx, { editable: false }));
      const list = h('div', { class: 'groups' });
      const fill = () => list.replaceChildren(...byFolder.map(([path, group]) => previewGroup(`rules:unmatched:${path}`,
        h('span', { text: `${path || '(top level)'} — ${group.length}` }), group, item)));
      if (state.unmatchedOpen) fill();
      unmatchedBox.replaceChildren(h('details', { class: 'unmatched', open: state.unmatchedOpen, ontoggle: (e) => {
        state.unmatchedOpen = e.currentTarget.open;
        if (state.unmatchedOpen && !list.childElementCount) fill();
      } },
      h('summary', {}, h('h2', { text: `Not matched by any rule: ${unmatched.length} bookmark(s)` }), ' ',
        helpLink('Bookmarks that no enabled rule matches, so the rules leave them alone; ignored bookmarks are left out', 'rules')),
      list));
    };

    const drawPreview = () => {
      const plan = scans.planFor(ctx, rules);
      const { changes, unmatched } = plan;
      paintStatus(plan);
      drawUnmatched(unmatched);
      if (!rules.length) return previewBox.replaceChildren();
      if (!changes.length) return previewBox.replaceChildren(h('h2', { text: 'Preview' }), emptyState('Nothing to do: every matching bookmark is already as the rules would leave it.'));

      const usable = changes.filter((c) => !c.problem);
      const sel = new Selection();
      sel.set(usable.map((c) => c.bookmark.id).filter((id) => !state.unticked.has(id)), true);
      sel.onChange(() => {
        for (const c of usable) sel.has(c.bookmark.id) ? state.unticked.delete(c.bookmark.id) : state.unticked.add(c.bookmark.id);
      });
      const apply = async () => {
        const chosen = usable.filter((c) => sel.has(c.bookmark.id));
        const waiting = chosen.filter((c) => c.waiting);
        // Asked for straight from the click, as Firefox only asks for permission then.
        const allowed = waiting.length ? askAllSites() : Promise.resolve(true);
        const deleting = chosen.filter((c) => c.remove).length;
        const notes = [
          deleting ? `${deleting} will be deleted.` : '',
          waiting.length ? `${waiting.length} page(s) are read first.` : '',
          'Missing folders are created. You can undo this from the history.',
          isDirty() ? 'Your rule changes will be saved too.' : '',
        ].filter(Boolean).join(' ');
        if (!(await confirmDialog(`Apply the rules to ${chosen.length} bookmark(s)? ${notes}`, 'Apply', deleting > 0))) return;
        let pages = null;
        if (waiting.length) {
          if (await allowed) pages = await readPages(ctx, waiting.map((c) => c.bookmark));
          else toast('Reading pages needs permission to access websites, so those steps are skipped.', 'error');
        }
        await ctx.run(async () => {
          // With pages read, or refused, the chosen bookmarks are planned again so later actions build on what was found.
          const ids = new Set(chosen.map((c) => c.bookmark.id));
          const skipped = new Map(waiting.map((c) => [c.bookmark.id, { url: c.bookmark.url, read: true }]));
          const final = waiting.length ? scans.planFor(ctx, rules, pages ?? skipped).changes.filter((c) => ids.has(c.bookmark.id) && !c.problem) : chosen;
          const effective = final.filter(hasEffect);
          if (isDirty()) await persistDraft();
          await ctx.actions.applyRules(effective.map((c) => ({ ...c, id: c.bookmark.id })), `Ran rules on ${effective.length} bookmark(s)`);
          ctx.done(`Applied the rules to ${effective.length} bookmark(s).`);
        });
      };
      const changeRow = (c) => {
        const content = h('div', { class: 'grow' },
          bookmarkInfo(c.bookmark, ctx, {
            editable: false,
            highlight: c.why,
            meta: [h('span', { class: 'matched', text: c.why?.terms.length ? `Matched ${matchedText(c.why)}` : '', hidden: !c.why?.terms.length })],
          }),
          stepList(c),
          becomes(c),
          c.problem && h('div', { class: 'warn', text: c.problem }));
        if (!c.problem) return row(sel, c.bookmark.id, content);
        return h('li', { class: 'item' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', disabled: true, 'aria-label': c.problem })), content);
      };
      // Changes are grouped by the first rule that acts on them.
      const groups = [...groupBy(changes, (c) => c.steps[0].ruleId)];
      const list = h('div', { class: 'groups' }, groups.map(([id, group]) => {
        const name = ruleName(rules.find((r) => r.id === id) ?? {});
        const ids = group.filter((c) => !c.problem).map((c) => c.bookmark.id);
        return previewGroup(`rules:preview:${id}`, [h('span', { text: `${name} — ${group.length}` }), selectAllToggle(sel, ids, 'Select group')], group, changeRow);
      }));
      bindCheckboxes(list, sel);
      const bar = selectionBar(sel, [{ label: 'Apply selected', primary: true, run: apply }],
        [h('h2', { text: `Preview: ${changes.length} bookmark(s) to change` }), selectAllToggle(sel, usable.map((c) => c.bookmark.id))]);
      const skipped = changes.length - usable.length;
      const note = skipped > 0 && h('p', { class: 'warn', text: `${skipped} bookmark(s) would get a URL that is not a valid address and are left out.` });
      previewBox.replaceChildren(...[bar, job.bar(), note, list].filter(Boolean));
    };

    const redraw = () => {
      drawList();
      paintStatus();
      changed();
    };

    const search = h('input', { type: 'search', value: state.query, placeholder: 'Find a rule', 'aria-label': 'Find a rule',
      oninput: (e) => {
        state.query = e.target.value;
        drawList();
        paintStatus();
      } });
    const setAll = (open) => {
      for (const r of rules) open ? state.expanded.add(r.id) : state.expanded.delete(r.id);
      drawList();
      paintStatus();
    };

    section.append(
      viewHeader('Rules', 'Rules run from the top down on the bookmarks matching their conditions, each taking its actions in order',
        dirtyNote,
        h('button', { class: 'small', text: 'Discard changes', onclick: () => { state.draft = null; ctx.render(); } }),
        h('button', { class: 'primary', text: 'Save rules', onclick: save })),
      h('div', { class: 'row wrap filters' },
        h('button', { class: 'small', text: '+ Rule', title: 'Add a rule at the end of the list', onclick: () => {
          const rule = newRule();
          rules.push(rule);
          state.expanded.add(rule.id);
          redraw();
          revealRule(rule.id);
        } }),
        search,
        h('button', { class: 'small', text: 'Expand all', onclick: () => setAll(true) }),
        h('button', { class: 'small', text: 'Collapse all', onclick: () => setAll(false) })),
      listBox,
      previewBox,
      unmatchedBox);

    drawList();
    drawPreview();
    dirtyNote.textContent = isDirty() ? 'Unsaved changes' : '';
    return section;
  },
};
