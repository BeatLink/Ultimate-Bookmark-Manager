// Organize rules: edit rules that file bookmarks into folders, preview the moves, then apply them.

import { h, Selection, toast, confirmDialog, promptDialog } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectionBar, selectAllToggle, bookmarkInfo, row, pagedList, pickFolder, pickRule, marked, helpLink, actionMenu } from '../components.js';
import { mountQueryEditor } from '../query-editor.js';
import { saveSettings } from '../../lib/settings.js';
import { newRule, duplicateRule, moveToNewRule, mergeRules, moveRulePaths, resolveTarget, ruleName, folderLabel } from '../../lib/rules.js';
import { maxScore } from '../../lib/matching.js';
import { rankingWarnings } from '../../lib/organize.js';
import { eligibleToOutrank, eligibleToRankBelow } from '../../lib/rule-order.js';
import { formatScore } from '../../lib/specificity.js';
import { rootFoldersOf, isFolder } from '../../lib/tree.js';
import { groupBy, countBy } from '../../lib/group.js';
import * as scans from '../scans.js';

// What the page remembers between renders, so a refresh after any other action does not lose the user's place.
const state = {
  // Unsaved edits, and the saved rules they started from; an untouched draft follows the saved rules when they change.
  draft: null,
  draftBase: null,
  // Moves the user unticked in the preview.
  unticked: new Set(),
  // Rules shown open; saved rules start closed, while new and duplicated ones open for editing.
  expanded: new Set(),
  // Folders the user opened or closed by hand; the rest are open when they or a folder inside them hold rules.
  folderOpen: new Map(),
  query: '',
  onlyWithRules: false,
  unmatchedOpen: false,
};

// Each open rule's query editor, taken down when the tree is redrawn.
const editors = new Map();

// The preview is redrawn this long after the last edit.
const PREVIEW_DELAY_MS = 300;

const PART_NAMES = { title: 'title', url: 'URL', host: 'site name', path: 'path', query: 'query string', fragment: 'part after #' };

const SPECIFICITY_HELP = 'Most this rule can score when every condition matches; only conditions that match a bookmark count. Conditions on the URL always outrank keywords: exact URL 1000, URL path 100 + 10 per segment, exact query string 80, subdomain or query parameter with value 60, domain 50, query parameter 30, other URL text 20. Keyword conditions (title, or title or URL): exact title 40, keyword 20, regex 15.';

const ruleLabel = (r) => `${ruleName(r)} → ${r.target ? folderLabel(r.target) : 'no folder yet'}`;
const quoted = (r) => `“${ruleName(r)}”`;

const ALL = '*';
const RELATIONS = { above: 'ranks above', below: 'ranks below' };

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

// Every rule that matched a bookmark, strongest first with why each lost; selecting one re-highlights what it matched.
function rankingList(move) {
  const show = (r, button) => {
    const box = button.closest('.bm');
    const { title, url } = move.bookmark;
    const link = box.querySelector('.bm-title a');
    if (link && title) link.replaceChildren(...marked(title, r.why?.title));
    box.querySelector('.bm-url')?.replaceChildren(...marked(url, r.why?.url));
    const note = box.querySelector('.matched');
    if (note) {
      note.hidden = false;
      note.textContent = r.why?.terms.length ? `${r.lost ? `${ruleName(r)} matched` : 'Matched'} ${matchedText(r.why)}` : `${ruleName(r)} matched nothing to highlight`;
    }
    for (const b of box.querySelectorAll('.ranking-pick')) b.setAttribute('aria-pressed', String(b === button));
  };
  // The list is only built the first time it is opened.
  const details = h('details', { class: 'ranking', ontoggle: () => {
    if (!details.open || details.childElementCount > 1) return;
    details.append(
      h('ol', {}, move.ranking.map((r) => h('li', { class: r.lost ? 'lost' : 'won' },
        h('button', { class: 'ranking-pick', type: 'button', 'aria-pressed': String(!r.lost), title: 'Highlight what this rule matched', onclick: (e) => show(r, e.currentTarget) },
          h('strong', { text: ruleName(r) }),
          h('span', { class: 'muted', text: ` → ${r.target.path.join(' › ')}` })),
        h('div', { class: 'small muted' },
          [formatScore(r.score), r.why?.terms.length ? `matched ${matchedText(r.why)}` : ''].filter(Boolean).join(' · ')),
        h('div', { class: 'small' }, r.lost ? h('span', { class: 'lost-reason', text: `Lost: ${r.lost}` }) : h('strong', { class: 'won-label', text: 'Wins' }))))));
  } }, h('summary', { text: `All ${move.others + 1} matching rules`, title: 'Strongest first; select a rule to highlight what it matched' }));
  return details;
}

// Every other rule as a picker entry under its destination folder, greyed out with `reason` when not in `allowed`.
function ruleEntries(ctx, rule, rules, allowed, reason) {
  const roots = rootFoldersOf(ctx.state.root);
  const ok = new Set(allowed.map((r) => r.id));
  return rules.filter((r) => r !== rule).map((r) => ({
    id: r.id,
    label: ruleName(r),
    folder: resolveTarget(r.target, roots)?.path.join('/') ?? '',
    disabled: !ok.has(r.id),
    reason: ok.has(r.id) ? ruleLabel(r) : reason,
  }));
}

// The rule's ranking as rows of "ranks above / below" a rule or all other rules; "ranks below X" is stored in X's list.
function rankingEditor(ctx, rule, rules, redraw) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const links = [
    ...(rule.rankAll ? [{ rel: rule.rankAll, target: ALL }] : []),
    ...(rule.outranks ?? []).filter((id) => byId.has(id)).map((id) => ({ rel: 'above', target: id })),
    ...rules.filter((r) => r.outranks?.includes(rule.id)).map((r) => ({ rel: 'below', target: r.id })),
  ];
  const remove = ({ rel, target }) => {
    if (target === ALL) delete rule.rankAll;
    else if (rel === 'above') rule.outranks = (rule.outranks ?? []).filter((id) => id !== target);
    else byId.get(target).outranks = byId.get(target).outranks.filter((id) => id !== rule.id);
  };
  const add = ({ rel, target }) => {
    if (target === ALL) rule.rankAll = rel;
    else if (rel === 'above') rule.outranks = [...(rule.outranks ?? []), target];
    else byId.get(target).outranks = [...(byId.get(target).outranks ?? []), rule.id];
  };
  const allowed = ({ rel, target }) => target === ALL ? !rule.rankAll
    : (rel === 'above' ? eligibleToOutrank : eligibleToRankBelow)(rule, rules).some((r) => r.id === target);
  // Swaps one link for another, putting the old one back when the new one is not allowed.
  const change = (from, to) => {
    if (from) remove(from);
    if (to.target && allowed(to)) add(to);
    else if (from) {
      add(from);
      toast(to.target === ALL ? 'This rule already ranks against all other rules.' : 'That would make a loop or go against a rule that ranks above or below all others.', 'error');
    }
    redraw();
  };
  const rankRow = (link) => {
    let rel = link?.rel ?? 'above';
    // The rule it ranks against is chosen from the folder tree; the current one stays choosable.
    const pick = async () => {
      const eligible = (rel === 'above' ? eligibleToOutrank : eligibleToRankBelow)(rule, rules);
      const current = link && link.target !== ALL ? [byId.get(link.target)] : [];
      const why = rel === 'above' ? 'Not offered: it ranks above this rule already, or is in a higher tier' : 'Not offered: this rule ranks above it already, or it is in a lower tier';
      const extras = !rule.rankAll || link?.target === ALL ? [{ id: ALL, label: 'All other rules' }] : [];
      const chosen = await pickRule(ctx.state.root, ruleEntries(ctx, rule, rules, [...current, ...eligible], why),
        { heading: `This rule ${RELATIONS[rel]}…`, current: link?.target ?? '', extras });
      if (chosen && chosen !== link?.target) change(link, { rel, target: chosen });
    };
    const targetText = !link ? 'Choose a rule…' : link.target === ALL ? 'all other rules' : ruleLabel(byId.get(link.target));
    const target = h('button', { class: `rank-target rule-button${link ? '' : ' unset'}`, type: 'button', 'aria-label': 'Rule it ranks against', onclick: pick },
      h('span', { class: link?.target === ALL ? 'rank-all-icon' : 'rule-icon', 'aria-hidden': 'true' }), targetText);
    const relation = h('select', { class: 'rank-relation', 'aria-label': 'Ranks above or below', onchange: (e) => {
      rel = e.target.value;
      if (link) change(link, { rel, target: link.target });
    } }, Object.entries(RELATIONS).map(([value, text]) => h('option', { value, text, selected: value === rel })));
    const el = h('div', { class: 'rank-row' }, relation, target,
      h('button', { class: 'small', text: '×', title: 'Remove', 'aria-label': 'Remove ranking', onclick: () => (link ? (remove(link), redraw()) : el.remove()) }));
    return el;
  };
  const list = h('div', { class: 'rank-rows' }, links.map(rankRow));
  return field([h('span', { text: 'Ranking ' }), helpLink('A rule ranked above another wins when both match; ranking above or below all other rules sets its tier; unranked rules are ordered by specificity', 'organize')],
    list,
    h('button', { class: 'small', text: '+ Ranking', onclick: () => list.append(rankRow(null)) }));
}

// A menu item that picks a rule to merge into this one; the chosen rule's conditions join this rule's and it is removed.
function mergeAction(ctx, rule, rules, redraw) {
  const others = rules.filter((r) => r !== rule);
  return { label: 'Merge…', title: 'Merge another rule into this one', disabled: !others.length, run: async () => {
    const id = await pickRule(ctx.state.root, ruleEntries(ctx, rule, rules, others, ''), { heading: `Merge into ${quoted(rule)}`, confirm: 'Merge this rule' });
    const other = others.find((r) => r.id === id);
    if (!other) return;
    const elsewhere = other.target !== rule.target ? ` Bookmarks it matches will go to ${rule.target ? folderLabel(rule.target) : 'this rule’s folder'} instead.` : '';
    if (!(await confirmDialog(`Merge ${quoted(other)} into ${quoted(rule)}? This rule will match whatever either of them matched, and ${quoted(other)} is removed.${elsewhere}`, 'Merge', false))) return;
    rules.splice(0, rules.length, ...mergeRules(rules, rule.id, other.id));
    state.expanded.add(rule.id);
    redraw();
  } };
}

// One labelled row of a rule's editor; the labels share a column, so every row's controls start at the same place.
function field(label, ...controls) {
  return h('div', { class: 'field-row' }, h('span', { class: 'field-label' }, label), h('div', { class: 'field-value' }, ...controls));
}

// A rule as a one-line summary row that expands into its editor; `parts` receives the bits refreshed while editing.
function ruleCard(ctx, rule, rules, { redraw, changed, revealRule }, parts) {
  const bodyId = `rule-body-${rule.id}`;
  const isOpen = state.expanded.has(rule.id);
  const body = h('div', { class: 'rule-body', id: bodyId, hidden: !isOpen });
  // The editor is only built the first time the rule is opened.
  const fillBody = () => body.append(
    h('label', { class: 'field-row' }, h('span', { class: 'field-label', text: 'Enabled' }), h('span', { class: 'field-value' },
      h('input', { type: 'checkbox', checked: rule.enabled !== false, 'aria-label': 'Rule enabled', onchange: (e) => { rule.enabled = e.target.checked; redraw(); } }))),
    field('Rule', queryEditor(ctx, rule, changed, (itemId) => {
      const moved = moveToNewRule(rules, rule.id, itemId);
      if (!moved) return;
      rules.splice(0, rules.length, ...moved.rules);
      state.expanded.add(moved.part.id);
      // Redrawn after the click is handled, as the redraw takes down the editor the click came from.
      setTimeout(redraw);
    })),
    rankingEditor(ctx, rule, rules, redraw),
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
  const name = h('span', { class: `rule-name${rule.name ? '' : ' unnamed'}`, text: ruleName(rule), onclick: () => toggle.click() });
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
      rules.splice(rules.indexOf(rule) + 1, 0, copy);
      redraw();
      revealRule(copy.id);
    } },
    { label: 'Move…', title: `Choose the folder this rule files into${rule.target ? ` (now ${folderLabel(rule.target)})` : ''}`, run: async () => {
      const picked = await pickFolder(ctx.state.root, rule.target, { heading: `Move ${quoted(rule)}`, verb: 'Move rule here' });
      if (!picked || picked === rule.target) return;
      rule.target = picked;
      state.folderOpen.set(picked, true);
      redraw();
      revealRule(rule.id);
    } },
    mergeAction(ctx, rule, rules, redraw),
    null,
    { label: 'Delete', danger: true, run: () => {
      state.expanded.delete(rule.id);
      rules.splice(rules.indexOf(rule), 1);
      // Other rules stop listing it.
      for (const r of rules) if (r.outranks?.includes(rule.id)) r.outranks = r.outranks.filter((id) => id !== rule.id);
      redraw();
    } },
  ], 'Rule actions');

  const card = h('li', { class: `rule-card${rule.enabled === false ? ' disabled' : ''}${isOpen ? ' open' : ''}`, 'data-rule': rule.id },
    h('div', { class: 'rule-head' },
      parts.handle,
      toggle,
      name,
      parts.score,
      parts.badge,
      menu),
    body);
  return card;
}

// The bookmark folder tree, each node with its path key as rules store it ("Bookmarks Menu/Dev/Rust").
function folderTree(root) {
  const walk = (node, path, depth) => {
    const own = [...path, node.title ?? ''];
    return {
      id: node.id, title: node.title || '(no name)', key: own.join('/'), path: own, depth,
      children: (node.children ?? []).filter(isFolder).map((c) => walk(c, own, depth + 1)),
    };
  };
  return (root.children ?? []).map((c) => walk(c, [], 0));
}

// A group of preview rows under a sticky heading, shown a page at a time.
function previewGroup(key, heading, items, make) {
  const list = h('ul', { class: 'items' });
  const more = pagedList(key, list, items, make);
  return h('section', { class: 'group' }, h('h2', { class: 'group-title sticky' }, heading), list, more);
}

export default {
  id: 'organize',
  label: 'Organize',
  badge: (ctx) => scans.organizePlan(ctx).moves.length,

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
    const roots = rootFoldersOf(ctx.state.root);
    const section = h('section', { class: 'organize' });
    const treeBox = h('div', { class: 'rule-tree' });
    const previewBox = h('div');
    const unmatchedBox = h('div');
    const dirtyNote = h('span', { class: 'muted small' });

    const isDirty = () => JSON.stringify(draft) !== JSON.stringify(ctx.state.settings.organize);
    const persistDraft = async () => {
      await saveSettings({ ...ctx.state.settings, organize: draft });
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
    // Each folder's "would move here" count, refreshed with the cards as rules are edited.
    const folderCounts = new Map();
    const revealRule = (id) => treeBox.querySelector(`[data-rule="${id}"]`)?.scrollIntoView?.({ block: 'nearest' });
    const card = (r) => {
      const parts = {
        handle: ruleHandle(r),
        info: h('div', { class: 'rule-info' }),
        badge: h('span', { class: 'rule-badge' }),
        score: h('span', { class: 'score-chip' }),
      };
      cardParts.set(r.id, parts);
      return ruleCard(ctx, r, rules, { redraw, changed, revealRule }, parts);
    };
    const folderKeyOf = (r) => resolveTarget(r.target, roots)?.path.join('/') ?? '';
    // A rule's folder is set, the rule opened for editing and the tree redrawn with the rule in view.
    const placeRule = (rule, key) => {
      rule.target = key;
      state.expanded.add(rule.id);
      if (key) state.folderOpen.set(key, true);
      if (!rules.includes(rule)) rules.push(rule);
      redraw();
      revealRule(rule.id);
    };

    // Creates a subfolder straight away, as one undoable change, and opens its parent so it shows.
    const addFolder = async (n) => {
      const title = await promptDialog(`Name of the new folder in ${n.title}`, 'Create folder');
      if (!title) return;
      if (n.children.some((c) => c.title === title)) return toast(`${n.title} already has a folder called “${title}”.`, 'error');
      state.folderOpen.set(n.key, true);
      await ctx.run(async () => {
        await ctx.actions.createFolder(n.id, title);
        ctx.done(`Created “${title}”.`);
      });
    };

    // The folder or rule being dragged: any folder but the root folders can move into another, and a rule onto any folder but its own.
    let dragging = null;
    let draggingRule = null;
    const contains = (folder, id) => folder.id === id || folder.children.some((c) => contains(c, id));
    const canDrop = (target) => (draggingRule
      ? folderKeyOf(draggingRule) !== target.key
      : dragging && dragging.id !== target.id && !contains(dragging, target.id) && !target.children.some((c) => c.id === dragging.id));
    const clearDrag = () => {
      dragging = null;
      draggingRule = null;
      for (const el of treeBox.querySelectorAll('.drop-into')) el.classList.remove('drop-into');
    };
    const ruleHandle = (r) => h('span', { class: 'rule-drag', draggable: 'true', role: 'img', 'aria-label': 'Drag handle', title: 'Drag onto a folder to file this rule there', text: '⠿',
      ondragstart: (e) => {
        e.stopPropagation();
        draggingRule = r;
        e.dataTransfer.setData('application/x-organize-rule', r.id);
        e.dataTransfer.effectAllowed = 'move';
        const card = e.currentTarget.closest('.rule-card');
        if (card) e.dataTransfer.setDragImage(card, 12, 12);
      },
      ondragend: clearDrag });
    const moveFolder = (folder, target) => {
      if (target.children.some((c) => c.path.at(-1) === folder.path.at(-1))) return toast(`${target.title} already has a folder called “${folder.title}”.`, 'error');
      const from = folder.path;
      const to = [...target.path, folder.path.at(-1)];
      state.folderOpen.set(target.key, true);
      return ctx.run(async () => {
        // The saved rules are rewritten with the move, as one undoable step; unsaved rule edits follow the folder too.
        await ctx.actions.moveFolder(folder.id, target.id, { from, to });
        draft.rules = moveRulePaths(draft.rules, from, to, roots);
        ctx.done(`Moved “${folder.title}” into “${target.title}”.`);
      });
    };
    const dragProps = (n) => ({
      draggable: n.depth > 0 ? 'true' : null,
      ondragstart: (e) => {
        if (n.depth === 0) return;
        e.stopPropagation();
        dragging = n;
        e.dataTransfer.setData('application/x-bookmark-folder', n.id);
        e.dataTransfer.effectAllowed = 'move';
      },
      ondragend: clearDrag,
      ondragover: (e) => {
        if (!canDrop(n)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        e.currentTarget.classList.add('drop-into');
      },
      ondragleave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drop-into');
      },
      ondrop: (e) => {
        if (!dragging && !draggingRule) return;
        e.preventDefault();
        e.stopPropagation();
        const ok = canDrop(n);
        const folder = dragging;
        const rule = draggingRule;
        clearDrag();
        if (!ok) return;
        // A rule dropped on a folder files into it from then on; like any rule edit, it is saved with the other changes.
        if (rule) placeRule(rule, n.key);
        else moveFolder(folder, n);
      },
    });

    // The whole tree is rebuilt when rules are added, removed or moved; typing only refreshes the cards' text.
    const drawTree = () => {
      for (const unmount of editors.values()) unmount();
      editors.clear();
      cardParts.clear();
      folderCounts.clear();
      const tree = folderTree(ctx.state.root);
      const keys = new Set();
      const collect = (n) => { keys.add(n.key); n.children.forEach(collect); };
      tree.forEach(collect);
      const byKey = groupBy(rules.filter((r) => keys.has(folderKeyOf(r))), folderKeyOf);
      const orphans = rules.filter((r) => !keys.has(folderKeyOf(r)));
      const withRules = new Map();
      const holds = (n) => {
        if (!withRules.has(n.key)) withRules.set(n.key, byKey.has(n.key) || n.children.some(holds));
        return withRules.get(n.key);
      };
      const q = state.query.trim().toLowerCase();
      const matchesQuery = (n) => !q || n.title.toLowerCase().includes(q) || n.children.some(matchesQuery);
      const shown = (n) => matchesQuery(n) && (!state.onlyWithRules || holds(n));

      const node = (n) => {
        const own = byKey.get(n.key) ?? [];
        const kids = n.children.filter(shown);
        const open = q ? true : state.folderOpen.get(n.key) ?? (n.depth === 0 || holds(n));
        // A closed folder's contents are only built the first time it is opened.
        const children = h('ul', { class: 'folder-children', hidden: !open });
        let filled = false;
        const fill = () => {
          filled = true;
          children.append(...own.map(card), ...kids.map(node));
        };
        if (open) fill();
        const countEl = h('span', { class: 'rule-badge active' });
        folderCounts.set(n.key, countEl);
        const toggleLabels = { collapse: `Collapse ${n.title}`, expand: `Expand ${n.title}` };
        const toggle = h('button', { class: 'folder-toggle', type: 'button', hidden: !own.length && !kids.length,
          onclick: () => {
            const opening = children.hidden;
            state.folderOpen.set(n.key, opening);
            if (opening && !filled) {
              fill();
              paintStatus();
            }
            children.hidden = !opening;
            setToggle(toggle, opening, toggleLabels);
          } }, h('span', { class: 'chevron', 'aria-hidden': 'true' }));
        setToggle(toggle, open, toggleLabels);
        return h('li', { class: 'folder-node', 'data-folder': n.key },
          h('div', { class: 'folder-head', style: `--depth: ${n.depth}`, title: n.depth > 0 ? 'Drag onto another folder to move it there' : null, ...dragProps(n) },
            toggle,
            h('span', { class: 'folder-icon', 'aria-hidden': 'true' }),
            h('span', { class: 'folder-title', text: n.title }),
            own.length > 0 && h('span', { class: 'muted small', text: `${own.length} rule(s)` }),
            countEl,
            h('div', { class: 'rule-actions' },
              h('button', { class: 'small', text: '+ Rule', title: `Add a rule that files bookmarks into ${n.title}`, onclick: () => placeRule(newRule(), n.key) }),
              h('button', { class: 'small', text: '+ Folder', title: `Create a folder inside ${n.title}`, onclick: () => addFolder(n) }))),
          children);
      };

      const visible = tree.filter(shown);
      const orphanBox = orphans.length > 0 && h('section', { class: 'orphan-rules' },
        h('h2', {}, 'Rules for folders that do not exist yet ', helpLink('A missing folder is created when its rule first moves something into it; rules still choosing a folder are here too', 'organize')),
        h('ul', { class: 'folder-children' }, orphans.map(card)));
      treeBox.replaceChildren(
        ...(orphanBox ? [orphanBox] : []),
        visible.length ? h('ul', { class: 'folder-tree-list' }, visible.map(node)) : emptyState('No folders match.'));
    };

    // Each folder's count of bookmarks that would move into it.
    const paintFolderCounts = (incoming) => {
      for (const [key, el] of folderCounts) {
        const count = incoming.get(key) ?? 0;
        el.textContent = count ? `${count} would move here` : '';
        el.hidden = !count;
      }
    };

    // A rule card's score chip, badge and info line from the plan.
    const paintCard = (r, parts, { problems, warnings, matched, won, moving }) => {
      const above = (r.outranks ?? []).filter((id) => rules.some((x) => x.id === id)).length;
      const tier = r.rankAll === 'above' ? ' · above all' : r.rankAll === 'below' ? ' · below all' : '';
      parts.score.textContent = `≤ ${formatScore(maxScore(r))}${tier}${above ? ` · above ${above}` : ''}`;
      parts.score.title = `${r.rankAll ? `Ranks ${r.rankAll} all other rules. ` : ''}${above ? `Ranks above ${above} rule(s) by your ranking lists. ` : ''}${SPECIFICITY_HELP}`;
      parts.score.classList.toggle('prioritised', above > 0 || !!r.rankAll);
      const issues = problems.get(r.id);
      if (issues) {
        parts.info.replaceChildren(...issues.map((x) => h('p', { class: 'error small', text: x })));
        parts.badge.textContent = 'Needs attention';
        parts.badge.className = 'rule-badge error';
        parts.badge.title = issues.join(' ');
        return;
      }
      const lost = matched > won ? ` ${matched - won} go to a rule ranked above it, or to a more specific match.` : '';
      parts.info.replaceChildren(
        h('p', { class: 'muted small', text: `Matches ${matched} bookmark(s) and wins ${won}: ${moving} would move, the rest are already in place.${lost}` }),
        ...(warnings.get(r.id) ?? []).map((x) => h('p', { class: 'warn small', text: x })));
      parts.badge.textContent = r.enabled === false ? 'Off' : `${moving} to move`;
      parts.badge.className = `rule-badge${moving && r.enabled !== false ? ' active' : ''}`;
      parts.badge.title = `Matches ${matched}, wins ${won}, ${moving} would move`;
    };

    // Refreshes the counts and notes on every folder and rule card from the current plan.
    const paintStatus = (plan = scans.planFor(ctx, rules)) => {
      const { moves, problems, wins, matches } = plan;
      const warnings = rankingWarnings(rules);
      const incoming = countBy(moves, (m) => m.target.path.join('/'));
      const moving = countBy(moves, (m) => m.ruleId);
      paintFolderCounts(incoming);
      for (const r of rules) {
        const parts = cardParts.get(r.id);
        if (parts) paintCard(r, parts, { problems, warnings, matched: matches.get(r.id) ?? 0, won: wins.get(r.id) ?? 0, moving: moving.get(r.id) ?? 0 });
      }
    };

    // Bookmarks no rule matches, grouped by the folder they are in; rows are built only once the list is opened.
    const drawUnmatched = (unmatched) => {
      if (!rules.length || !unmatched.length) return unmatchedBox.replaceChildren();
      const byFolder = [...groupBy(unmatched, (b) => (b.path ?? []).join(' › '))].sort(([a], [b]) => a.localeCompare(b));
      const item = (b) => h('li', { class: 'item' }, bookmarkInfo(b, ctx, { editable: false }));
      const list = h('div', { class: 'groups' });
      const fill = () => list.replaceChildren(...byFolder.map(([path, group]) => previewGroup(`organize:unmatched:${path}`,
        h('span', { text: `${path || '(top level)'} — ${group.length}` }), group, item)));
      if (state.unmatchedOpen) fill();
      unmatchedBox.replaceChildren(h('details', { class: 'unmatched', open: state.unmatchedOpen, ontoggle: (e) => {
        state.unmatchedOpen = e.currentTarget.open;
        if (state.unmatchedOpen && !list.childElementCount) fill();
      } },
      h('summary', {}, h('h2', { text: `Not matched by any rule: ${unmatched.length} bookmark(s)` }), ' ',
        helpLink('Bookmarks that no enabled rule matches, so organizing leaves them where they are; ignored bookmarks are left out', 'organize')),
      list));
    };

    const drawPreview = () => {
      const plan = scans.planFor(ctx, rules);
      const { moves, unmatched } = plan;
      paintStatus(plan);
      drawUnmatched(unmatched);
      if (!rules.length) return previewBox.replaceChildren(emptyState('No rules yet. Use “+ Rule” on a folder to start organizing.'));
      if (!moves.length) return previewBox.replaceChildren(h('h2', { text: 'Preview' }), emptyState('Nothing to move: every matching bookmark is already in its folder.'));

      const sel = new Selection();
      sel.set(moves.map((m) => m.bookmark.id).filter((id) => !state.unticked.has(id)), true);
      sel.onChange(() => {
        for (const m of moves) sel.has(m.bookmark.id) ? state.unticked.delete(m.bookmark.id) : state.unticked.add(m.bookmark.id);
      });
      const applyMoves = async () => {
        const chosen = moves.filter((m) => sel.has(m.bookmark.id));
        if (!(await confirmDialog(`Move ${chosen.length} bookmark(s) into their rule folders? Missing folders are created. You can undo this from the history.${isDirty() ? ' Your rule changes will be saved too.' : ''}`, 'Move', false))) return;
        await ctx.run(async () => {
          if (isDirty()) await persistDraft();
          await ctx.actions.organize(chosen.map((m) => ({ id: m.bookmark.id, target: m.target })));
          ctx.done(`Moved ${chosen.length} bookmark(s).`);
        });
      };
      const moveRow = (m) => row(sel, m.bookmark.id, bookmarkInfo(m.bookmark, ctx, {
        editable: false,
        highlight: m.why,
        meta: [h('span', { class: 'matched', text: m.why?.terms.length ? `Matched ${matchedText(m.why)}` : '', hidden: !m.why?.terms.length }),
          h('span', { text: `Rule: ${m.ruleName || 'unnamed'} · ${formatScore(m.score)}${m.others ? ` · beat ${m.others} other matching rule(s)` : ''}` }),
          m.others > 0 && rankingList(m)],
      }));
      const list = h('div', { class: 'groups' }, [...groupBy(moves, (m) => m.target.path.join('/'))].map(([path, group]) => previewGroup(`organize:preview:${path}`,
        [h('span', { text: `→ ${folderLabel(path)} — ${group.length}` }), selectAllToggle(sel, group.map((m) => m.bookmark.id), 'Select group')], group, moveRow)));
      bindCheckboxes(list, sel);
      const bar = selectionBar(sel, [{ label: 'Move selected', primary: true, run: applyMoves }],
        [h('h2', { text: `Preview: ${moves.length} bookmark(s) to move` }), selectAllToggle(sel, moves.map((m) => m.bookmark.id))]);
      previewBox.replaceChildren(bar, list);
    };

    const redraw = () => {
      drawTree();
      paintStatus();
      changed();
    };
    const redrawTree = () => {
      drawTree();
      paintStatus();
    };

    const search = h('input', { type: 'search', value: state.query, placeholder: 'Find a folder', 'aria-label': 'Find a folder',
      oninput: (e) => { state.query = e.target.value; redrawTree(); } });
    const setAll = (open) => {
      const all = (n) => { state.folderOpen.set(n.key, open); n.children.forEach(all); };
      folderTree(ctx.state.root).forEach(all);
      redrawTree();
    };

    section.append(
      viewHeader('Organize', 'Rules that file bookmarks into folders',
        dirtyNote,
        h('button', { class: 'small', text: 'Discard changes', onclick: () => { state.draft = null; ctx.render(); } }),
        h('button', { class: 'primary', text: 'Save rules', onclick: save })),
      h('label', { class: 'check-line', title: 'A few seconds after each is added; skipped if you pick a folder yourself, or when many arrive at once as during an import or sync' },
        h('input', { type: 'checkbox', checked: draft.autoApply, onchange: (e) => { draft.autoApply = e.target.checked; changed(); } }),
        'Organize new bookmarks automatically'),
      h('div', { class: 'row wrap filters' },
        search,
        h('label', { class: 'check-line small' },
          h('input', { type: 'checkbox', checked: state.onlyWithRules, onchange: (e) => { state.onlyWithRules = e.target.checked; redrawTree(); } }),
          'Only folders with rules'),
        h('button', { class: 'small', text: 'Expand all', onclick: () => setAll(true) }),
        h('button', { class: 'small', text: 'Collapse all', onclick: () => setAll(false) }),
        h('button', { class: 'small', text: '+ Rule for a new folder', title: 'Add a rule whose folder you pick or create', onclick: async () => {
          const key = await pickFolder(ctx.state.root, '', { heading: 'Folder for the new rule', verb: 'Add rule here' });
          if (key) placeRule(newRule(), key);
        } })),
      treeBox,
      previewBox,
      unmatchedBox);

    drawTree();
    drawPreview();
    dirtyNote.textContent = isDirty() ? 'Unsaved changes' : '';
    return section;
  },
};
