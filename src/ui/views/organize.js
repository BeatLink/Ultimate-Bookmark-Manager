// Organize rules: edit rules that file bookmarks into folders, preview the moves, then apply them.

import { h, Selection, toast, confirmDialog, promptDialog } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectAllToggle, bookmarkInfo, row, pickFolder, pickRule, marked, helpLink, actionMenu } from '../components.js';
import { mountQueryEditor } from '../query-editor.js';
import { saveSettings } from '../../lib/settings.js';
import { newRule, duplicateRule, moveToNewRule, mergeRules, mergeCandidates, moveRulePaths, planMoves, resolveTarget, maxScore, rankingWarnings } from '../../lib/organize.js';
import { eligibleToOutrank, eligibleToRankBelow } from '../../lib/rule-order.js';
import { formatScore } from '../../lib/specificity.js';
import { nodeType } from '../../lib/tree.js';

// Unsaved edits live here so they survive the re-render that follows any other action.
let draft = null;
// The saved rules the draft started from; an untouched draft follows the saved rules when they change.
let draftBase = null;
// Moves the user unticked in the preview, so a refresh or an edited rule does not tick them again.
const unticked = new Set();

const rootFolders = (ctx) => ctx.state.root.children.map((c) => ({ id: c.id, title: c.title }));

// The last plan worked out, reused until the bookmarks, the ignore list or the rules change.
let lastPlan = { flat: null, whitelist: null, key: '', result: null };

export function plan(ctx, rules) {
  const key = JSON.stringify(rules);
  const { flat, whitelist } = ctx.state;
  if (lastPlan.flat === flat && lastPlan.whitelist === whitelist && lastPlan.key === key) return lastPlan.result;
  const result = planMoves(flat, rules, rootFolders(ctx), ctx.ignoredIds());
  lastPlan = { flat, whitelist, key, result };
  return result;
}

// Each open rule's query editor, taken down when the tree is redrawn.
const editors = new Map();

// The rule's conditions in a react-querybuilder editor.
function queryEditor(ctx, rule, changed, moveToNewRule) {
  const box = h('div', { class: 'query-box' });
  editors.get(rule.id)?.();
  editors.set(rule.id, mountQueryEditor(box, rule.query, (query) => { rule.query = query; changed(); }, { root: ctx.state.root, moveToNewRule }));
  return box;
}

// Rules shown open; saved rules start closed, while new and duplicated ones open for editing.
const expanded = new Set();
// Folders the user opened or closed by hand; the rest are open when they or a folder inside them hold rules.
const folderOpen = new Map();
// The folder search and the "only folders with rules" switch survive refreshes.
const treeView = { query: '', onlyWithRules: false };
// Whether the list of bookmarks no rule matches is open.
const unmatchedView = { open: false };

const PART_NAMES = { title: 'title', url: 'URL', host: 'site name', path: 'path', query: 'query string', fragment: 'part after #' };

// "“ccna” in title, “youtube.com” in URL" for a rule's match explanation.
function matchedText(why) {
  return why.terms.map((t) => `“${t.value}” in ${t.on.map((o) => PART_NAMES[o] ?? o).join(' and ')}`).join(', ');
}

// Every rule that matched a bookmark, strongest first, each with its standing and, below the winner, why it lost.
// Selecting a rule re-highlights the bookmark's title and URL with what that rule matched.
function rankingList(move) {
  const show = (r, button) => {
    const box = button.closest('.bm');
    const { title, url } = move.bookmark;
    const link = box.querySelector('.bm-title a');
    if (link && title) link.replaceChildren(...marked(title, r.why?.title));
    box.querySelector('.bm-url')?.replaceChildren(...marked(url, r.why?.url));
    const note = box.querySelector('.matched');
    if (note) note.hidden = false;
    if (note) note.textContent = r.why?.terms.length ? `${r.lost ? `${r.ruleName || 'Unnamed rule'} matched` : 'Matched'} ${matchedText(r.why)}` : `${r.ruleName || 'Unnamed rule'} matched nothing to highlight`;
    for (const b of box.querySelectorAll('.ranking-pick')) b.setAttribute('aria-pressed', String(b === button));
  };
  // The list is only built the first time it is opened.
  const details = h('details', { class: 'ranking', ontoggle: () => {
    if (!details.open || details.childElementCount > 1) return;
    details.append(
      h('ol', {}, move.ranking.map((r) => h('li', { class: r.lost ? 'lost' : 'won' },
      h('button', { class: 'ranking-pick', type: 'button', 'aria-pressed': String(!r.lost), title: 'Highlight what this rule matched', onclick: (e) => show(r, e.currentTarget) },
        h('strong', { text: r.ruleName || 'Unnamed rule' }),
        h('span', { class: 'muted', text: ` → ${r.target.path.join(' › ')}` })),
      h('div', { class: 'small muted' },
        [formatScore(r.score),
          r.why?.terms.length ? `matched ${matchedText(r.why)}` : ''].filter(Boolean).join(' · ')),
      h('div', { class: 'small' }, r.lost ? h('span', { class: 'lost-reason', text: `Lost: ${r.lost}` }) : h('strong', { class: 'won-label', text: 'Wins' }))))));
  } }, h('summary', { text: `All ${move.others + 1} matching rules`, title: 'Strongest first; select a rule to highlight what it matched' }));
  return details;
}

// How many rows each preview group shows before a "Show more" button.
const PREVIEW_ROWS = 100;

const SPECIFICITY_HELP = 'Most this rule can score when every condition matches; only conditions that match a bookmark count. Conditions on the URL always outrank keywords: exact URL 1000, URL path 100 + 10 per segment, exact query string 80, subdomain or query parameter with value 60, domain 50, query parameter 30, other URL text 20. Keyword conditions (title, or title or URL): exact title 40, keyword 20, regex 15.';

const ruleLabel = (r) => `${r.name || 'Unnamed rule'} → ${r.target ? r.target.split('/').join(' › ') : 'no folder yet'}`;

const ALL = '*';
const RELATIONS = { above: 'ranks above', below: 'ranks below' };

// Every other rule as an entry for the rule picker, filed under its destination folder; rules not in `allowed` are
// shown greyed out with `reason` as their tooltip.
function ruleEntries(ctx, rule, rules, allowed, reason) {
  const roots = rootFolders(ctx);
  const ok = new Set(allowed.map((r) => r.id));
  return rules.filter((r) => r !== rule).map((r) => ({
    id: r.id,
    label: r.name || 'Unnamed rule',
    folder: resolveTarget(r.target, roots)?.path.join('/') ?? '',
    disabled: !ok.has(r.id),
    reason: ok.has(r.id) ? ruleLabel(r) : reason,
  }));
}

// The rule's ranking as rows of "ranks above / below" a rule or all other rules. "Ranks below X" is stored in X's list,
// so both rules always agree; the menus offer only rules that would not make a loop or go against the tiers.
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
  const row = (link) => {
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
  const list = h('div', { class: 'rank-rows' }, links.map(row));
  return field([h('span', { text: 'Ranking ' }), helpLink('A rule ranked above another wins when both match; ranking above or below all other rules sets its tier; unranked rules are ordered by specificity', 'organize')],
    list,
    h('button', { class: 'small', text: '+ Ranking', onclick: () => list.append(row(null)) }));
}

// A menu item that picks a rule to merge into this one; the chosen rule's conditions join this rule's and it is removed.
function mergeAction(ctx, rule, rules, redraw) {
  const others = mergeCandidates(rule, rules);
  return { label: 'Merge…', title: 'Merge another rule into this one', disabled: !others.length, run: async () => {
    const id = await pickRule(ctx.state.root, ruleEntries(ctx, rule, rules, others, ''), { heading: `Merge into “${rule.name || 'Unnamed rule'}”`, confirm: 'Merge this rule' });
    const other = others.find((r) => r.id === id);
    if (!other) return;
    const name = (r) => `“${r.name || 'Unnamed rule'}”`;
    const elsewhere = other.target !== rule.target ? ` Bookmarks it matches will go to ${rule.target ? rule.target.split('/').join(' › ') : 'this rule’s folder'} instead.` : '';
    if (!(await confirmDialog(`Merge ${name(other)} into ${name(rule)}? This rule will match whatever either of them matched, and ${name(other)} is removed.${elsewhere}`, 'Merge', false))) return;
    rules.splice(0, rules.length, ...mergeRules(rules, rule.id, other.id));
    expanded.add(rule.id);
    redraw();
  } };
}

// One labelled row of a rule's editor; the labels share a column, so every row's controls start at the same place.
function field(label, ...controls) {
  return h('div', { class: 'field-row' }, h('span', { class: 'field-label' }, label), h('div', { class: 'field-value' }, ...controls));
}

// A rule as a one-line summary row that expands into its editor; `parts` receives the bits refreshed while editing.
function ruleCard(ctx, rule, rules, redraw, changed, parts) {
  const bodyId = `rule-body-${rule.id}`;
  const isOpen = expanded.has(rule.id);
  const body = h('div', { class: 'rule-body', id: bodyId, hidden: !isOpen });
  // The editor is only built the first time the rule is opened.
  // Built with h() rather than append(), which would print a skipped part as the text "undefined".
  const fillBody = () => body.append(...h('div', {},
    h('label', { class: 'field-row' }, h('span', { class: 'field-label', text: 'Enabled' }), h('span', { class: 'field-value' },
      h('input', { type: 'checkbox', checked: rule.enabled !== false, 'aria-label': 'Rule enabled', onchange: (e) => { rule.enabled = e.target.checked; redraw(); } }))),
    field('Rule', queryEditor(ctx, rule, changed, (itemId) => {
      const moved = moveToNewRule(rules, rule.id, itemId);
      if (!moved) return;
      rules.splice(0, rules.length, ...moved.rules);
      expanded.add(moved.part.id);
      // Redrawn after the click is handled, as the redraw takes down the editor the click came from.
      setTimeout(redraw);
    })),
    rankingEditor(ctx, rule, rules, redraw),
    field('', parts.info)).childNodes);
  if (isOpen) fillBody();

  // The chevron and the name both open and close the rule.
  const toggle = h('button', {
    class: 'rule-toggle', type: 'button', 'aria-expanded': String(isOpen), 'aria-controls': bodyId,
    title: isOpen ? 'Collapse' : 'Edit this rule', 'aria-label': isOpen ? 'Collapse rule' : 'Edit rule',
    onclick: () => {
      const open = body.hidden;
      if (open && !body.childElementCount) fillBody();
      body.hidden = !open;
      open ? expanded.add(rule.id) : expanded.delete(rule.id);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.title = open ? 'Collapse' : 'Edit this rule';
      toggle.setAttribute('aria-label', open ? 'Collapse rule' : 'Edit rule');
      card.classList.toggle('open', open);
    },
  }, h('span', { class: 'chevron', 'aria-hidden': 'true' }));
  const name = h('span', { class: `rule-name${rule.name ? '' : ' unnamed'}`, text: rule.name || 'Unnamed rule', onclick: () => toggle.click() });
  const scrollTo = (id) => document.querySelector(`.organize [data-rule="${id}"]`)?.scrollIntoView?.({ block: 'nearest' });
  const menu = actionMenu([
    { label: 'Rename…', run: async () => {
      const value = await promptDialog('Rule name', 'Rename', rule.name ?? '');
      if (value === null || value === rule.name) return;
      rule.name = value;
      redraw();
    } },
    { label: 'Duplicate', title: 'Add an editable copy of this rule', run: () => {
      const copy = duplicateRule(rule);
      expanded.add(copy.id);
      rules.splice(rules.indexOf(rule) + 1, 0, copy);
      redraw();
      scrollTo(copy.id);
    } },
    { label: 'Move…', title: `Choose the folder this rule files into${rule.target ? ` (now ${rule.target.split('/').join(' › ')})` : ''}`, run: async () => {
      const picked = await pickFolder(ctx.state.root, rule.target, { heading: `Move “${rule.name || 'Unnamed rule'}”`, verb: 'Move rule here' });
      if (!picked || picked === rule.target) return;
      rule.target = picked;
      folderOpen.set(picked, true);
      redraw();
      scrollTo(rule.id);
    } },
    mergeAction(ctx, rule, rules, redraw),
    null,
    { label: 'Delete', danger: true, run: () => {
      expanded.delete(rule.id);
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
      children: (node.children ?? []).filter((c) => nodeType(c) === 'folder').map((c) => walk(c, own, depth + 1)),
    };
  };
  return (root.children ?? []).map((c) => walk(c, [], 0));
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
    const roots = rootFolders(ctx);
    const section = h('section', { class: 'organize' });
    const treeBox = h('div', { class: 'rule-tree' });
    const previewBox = h('div');
    const unmatchedBox = h('div');
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

    const cardParts = new Map();
    // Each folder's "would move here" count, refreshed with the cards as rules are edited.
    const folderCounts = new Map();
    const newParts = () => ({
      info: h('div', { class: 'rule-info' }),
      badge: h('span', { class: 'rule-badge' }),
      score: h('span', { class: 'score-chip' }),
    });
    const card = (r) => {
      const parts = newParts();
      parts.handle = ruleHandle(r);
      cardParts.set(r.id, parts);
      return ruleCard(ctx, r, rules, redraw, changed, parts);
    };
    const folderKeyOf = (r) => resolveTarget(r.target, roots)?.path.join('/') ?? '';
    const addRule = (rule, key) => {
      rule.target = key;
      expanded.add(rule.id);
      if (key) folderOpen.set(key, true);
      rules.push(rule);
      redraw();
      const el = treeBox.querySelector(`[data-rule="${rule.id}"]`);
      el?.scrollIntoView?.({ block: 'nearest' });
    };

    // Creates a subfolder straight away, as one undoable change, and opens its parent so it shows.
    const addFolder = async (n) => {
      const title = await promptDialog(`Name of the new folder in ${n.title}`, 'Create folder');
      if (!title) return;
      if (n.children.some((c) => c.title === title)) return toast(`${n.title} already has a folder called “${title}”.`, 'error');
      folderOpen.set(n.key, true);
      await ctx.run(async () => {
        await ctx.actions.createFolder(n.id, title);
        ctx.done(`Created “${title}”.`);
      });
    };

    // The folder or rule being dragged. Any folder but the root folders can be moved into another, and a rule onto any folder but its own.
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
    // A rule dropped on a folder files into it from then on; like any rule edit, it is saved with the other changes.
    const moveRule = (rule, target) => {
      rule.target = target.key;
      folderOpen.set(target.key, true);
      redraw();
      treeBox.querySelector(`[data-rule="${rule.id}"]`)?.scrollIntoView?.({ block: 'nearest' });
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
      folderOpen.set(target.key, true);
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
        if (rule) moveRule(rule, n);
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
      const byKey = new Map();
      const orphans = [];
      for (const r of rules) {
        const key = folderKeyOf(r);
        if (!keys.has(key)) orphans.push(r);
        else byKey.set(key, [...(byKey.get(key) ?? []), r]);
      }
      const withRules = new Map();
      const holds = (n) => {
        if (!withRules.has(n.key)) withRules.set(n.key, byKey.has(n.key) || n.children.some(holds));
        return withRules.get(n.key);
      };
      const q = treeView.query.trim().toLowerCase();
      const matchesQuery = (n) => !q || n.title.toLowerCase().includes(q) || n.children.some(matchesQuery);
      const shown = (n) => matchesQuery(n) && (!treeView.onlyWithRules || holds(n));

      const node = (n) => {
        const own = byKey.get(n.key) ?? [];
        const kids = n.children.filter(shown);
        const open = q ? true : folderOpen.get(n.key) ?? (n.depth === 0 || holds(n));
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
        return h('li', { class: 'folder-node', 'data-folder': n.key },
          h('div', { class: 'folder-head', style: `--depth: ${n.depth}`, title: n.depth > 0 ? 'Drag onto another folder to move it there' : null, ...dragProps(n) },
            h('button', { class: 'folder-toggle', type: 'button', 'aria-expanded': String(open), 'aria-label': `${open ? 'Collapse' : 'Expand'} ${n.title}`, hidden: !own.length && !kids.length,
              onclick: (e) => {
                const opening = children.hidden;
                folderOpen.set(n.key, opening);
                if (opening && !filled) {
                  fill();
                  refresh();
                }
                children.hidden = !opening;
                e.currentTarget.setAttribute('aria-expanded', String(opening));
                e.currentTarget.setAttribute('aria-label', `${opening ? 'Collapse' : 'Expand'} ${n.title}`);
              } }, h('span', { class: 'chevron', 'aria-hidden': 'true' })),
            h('span', { class: 'folder-icon', 'aria-hidden': 'true' }),
            h('span', { class: 'folder-title', text: n.title }),
            own.length > 0 && h('span', { class: 'muted small', text: `${own.length} rule(s)` }),
            countEl,
            h('div', { class: 'rule-actions' },
              h('button', { class: 'small', text: '+ Rule', title: `Add a rule that files bookmarks into ${n.title}`, onclick: () => addRule(newRule(), n.key) }),
              h('button', { class: 'small', text: '+ Folder', title: `Create a folder inside ${n.title}`, onclick: () => addFolder(n) }))),
          children);
      };

      const visible = tree.filter(shown);
      treeBox.replaceChildren(
        orphans.length > 0 && h('section', { class: 'orphan-rules' },
          h('h2', {}, 'Rules for folders that do not exist yet ', helpLink('A missing folder is created when its rule first moves something into it; rules still choosing a folder are here too', 'organize')),
          h('ul', { class: 'folder-children' }, orphans.map(card))),
        visible.length ? h('ul', { class: 'folder-tree-list' }, visible.map(node)) : emptyState('No folders match.'));
    };

    const refresh = () => {
      const { moves, problems, wins, matches } = plan(ctx, rules);
      refreshInfo(moves, problems, wins, matches);
    };
    const refreshInfo = (moves, problems, wins, matches) => {
      const warnings = rankingWarnings(rules);
      const incoming = new Map();
      const moving = new Map();
      for (const m of moves) {
        const key = m.target.path.join('/');
        incoming.set(key, (incoming.get(key) ?? 0) + 1);
        moving.set(m.ruleId, (moving.get(m.ruleId) ?? 0) + 1);
      }
      for (const [key, el] of folderCounts) {
        const count = incoming.get(key) ?? 0;
        el.textContent = count ? `${count} would move here` : '';
        el.hidden = !count;
      }
      for (const r of rules) {
        const parts = cardParts.get(r.id);
        if (!parts) continue;
        const above = (r.outranks ?? []).filter((id) => rules.some((x) => x.id === id)).length;
        const tier = r.rankAll === 'above' ? ' · above all' : r.rankAll === 'below' ? ' · below all' : '';
        const spec = maxScore(r);
        parts.score.textContent = `≤ ${formatScore(spec)}${tier}${above ? ` · above ${above}` : ''}`;
        parts.score.title = `${r.rankAll ? `Ranks ${r.rankAll} all other rules. ` : ''}${above ? `Ranks above ${above} rule(s) by your ranking lists. ` : ''}${SPECIFICITY_HELP}`;
        parts.score.classList.toggle('prioritised', above > 0 || !!r.rankAll);
        const issues = problems.get(r.id);
        if (issues) {
          parts.info.replaceChildren(...issues.map((x) => h('p', { class: 'error small', text: x })));
          parts.badge.textContent = 'Needs attention';
          parts.badge.className = 'rule-badge error';
          parts.badge.title = issues.join(' ');
          continue;
        }
        const matched = matches.get(r.id) ?? 0;
        const won = wins.get(r.id) ?? 0;
        const moves = moving.get(r.id) ?? 0;
        parts.info.replaceChildren(h('p', { class: 'muted small', text: `Matches ${matched} bookmark(s) and wins ${won}: ${moves} would move, the rest are already in place.${matched > won ? ` ${matched - won} go to a rule ranked above it, or to a more specific match.` : ''}` }),
          ...(warnings.get(r.id) ?? []).map((x) => h('p', { class: 'warn small', text: x })));
        parts.badge.textContent = r.enabled === false ? 'Off' : `${moves} to move`;
        parts.badge.className = `rule-badge${moves && r.enabled !== false ? ' active' : ''}`;
        parts.badge.title = `Matches ${matched}, wins ${won}, ${moves} would move`;
      }
    };

    // Bookmarks no rule matches, grouped by the folder they are in; rows are built only once the list is opened.
    const drawUnmatched = (unmatched) => {
      if (!rules.length || !unmatched.length) return unmatchedBox.replaceChildren();
      const byFolder = new Map();
      for (const b of unmatched) {
        const key = (b.path ?? []).join(' › ');
        if (!byFolder.has(key)) byFolder.set(key, []);
        byFolder.get(key).push(b);
      }
      const item = (b) => h('li', { class: 'item' }, bookmarkInfo(b, ctx, { editable: false }));
      const groupItems = (group) => {
        const items = h('ul', { class: 'items' }, group.slice(0, PREVIEW_ROWS).map(item));
        if (group.length <= PREVIEW_ROWS) return items;
        const more = h('button', { class: 'small', text: `Show ${group.length - PREVIEW_ROWS} more`, onclick: () => {
          items.append(...group.slice(PREVIEW_ROWS).map(item));
          more.remove();
        } });
        return [items, more];
      };
      const list = h('div', { class: 'groups' });
      const fill = () => list.replaceChildren(...[...byFolder].sort(([a], [b]) => a.localeCompare(b)).map(([path, group]) => h('section', { class: 'group' },
        h('h2', { class: 'group-title sticky' }, h('span', { text: `${path || '(top level)'} — ${group.length}` })),
        groupItems(group))));
      if (unmatchedView.open) fill();
      unmatchedBox.replaceChildren(h('details', { class: 'unmatched', open: unmatchedView.open, ontoggle: (e) => {
        unmatchedView.open = e.currentTarget.open;
        if (unmatchedView.open && !list.childElementCount) fill();
      } },
      h('summary', {}, h('h2', { text: `Not matched by any rule: ${unmatched.length} bookmark(s)` }), ' ',
        helpLink('Bookmarks that no enabled rule matches, so organizing leaves them where they are; ignored bookmarks are left out', 'organize')),
      list));
    };

    const drawPreview = () => {
      const { moves, unmatched, problems, wins, matches } = plan(ctx, rules);
      refreshInfo(moves, problems, wins, matches);
      drawUnmatched(unmatched);
      if (!rules.length) return previewBox.replaceChildren(emptyState('No rules yet. Use “+ Rule” on a folder to start organizing.'));
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

      const moveRow = (m) => row(sel, m.bookmark.id, bookmarkInfo(m.bookmark, ctx, {
        editable: false,
        highlight: m.why,
        meta: [h('span', { class: 'matched', text: m.why?.terms.length ? `Matched ${matchedText(m.why)}` : '', hidden: !m.why?.terms.length }),
          h('span', { text: `Rule: ${m.ruleName || 'unnamed'} · ${formatScore(m.score)}${m.others ? ` · beat ${m.others} other matching rule(s)` : ''}` }),
          m.others > 0 && rankingList(m)],
      }));
      // Long groups show their first rows until asked, since thousands of rows make every refresh slow; selection still covers them all.
      const groupItems = (group) => {
        const items = h('ul', { class: 'items' }, group.slice(0, PREVIEW_ROWS).map(moveRow));
        if (group.length <= PREVIEW_ROWS) return items;
        const more = h('button', { class: 'small', text: `Show ${group.length - PREVIEW_ROWS} more`, onclick: () => {
          items.append(...group.slice(PREVIEW_ROWS).map(moveRow));
          more.remove();
        } });
        return [items, more];
      };
      const list = h('div', { class: 'groups' }, [...byTarget].map(([path, group]) => h('section', { class: 'group' },
        h('h2', { class: 'group-title sticky' }, h('span', { text: `→ ${path.replaceAll('/', ' › ')} — ${group.length}` }), selectAllToggle(sel, group.map((m) => m.bookmark.id), 'Select group')),
        groupItems(group))));
      bindCheckboxes(list, sel);
      previewBox.replaceChildren(
        h('div', { class: 'selection-bar' },
          h('div', { class: 'row wrap' }, h('h2', { text: `Preview: ${moves.length} bookmark(s) to move` })),
          h('div', { class: 'row wrap end' }, selectAllToggle(sel, moves.map((m) => m.bookmark.id)), apply)),
        list);
    };

    const redraw = () => {
      drawTree();
      refresh();
      changed();
    };

    const search = h('input', { type: 'search', value: treeView.query, placeholder: 'Find a folder', 'aria-label': 'Find a folder',
      oninput: (e) => { treeView.query = e.target.value; drawTree(); refresh(); } });
    const setAll = (open) => {
      const all = (n) => { folderOpen.set(n.key, open); n.children.forEach(all); };
      folderTree(ctx.state.root).forEach(all);
      drawTree();
      refresh();
    };

    section.append(
      viewHeader('Organize', 'Rules that file bookmarks into folders',
        dirtyNote,
        h('button', { class: 'small', text: 'Discard changes', onclick: () => { draft = null; ctx.render(); } }),
        h('button', { class: 'primary', text: 'Save rules', onclick: () => save() })),
      h('label', { class: 'check-line', title: 'A few seconds after each is added; skipped if you pick a folder yourself, or when many arrive at once as during an import or sync' },
        h('input', { type: 'checkbox', checked: draft.autoApply, onchange: (e) => { draft.autoApply = e.target.checked; changed(); } }),
        'Organize new bookmarks automatically'),
      h('div', { class: 'row wrap filters' },
        search,
        h('label', { class: 'check-line small' },
          h('input', { type: 'checkbox', checked: treeView.onlyWithRules, onchange: (e) => { treeView.onlyWithRules = e.target.checked; drawTree(); refresh(); } }),
          'Only folders with rules'),
        h('button', { class: 'small', text: 'Expand all', onclick: () => setAll(true) }),
        h('button', { class: 'small', text: 'Collapse all', onclick: () => setAll(false) }),
        h('button', { class: 'small', text: '+ Rule for a new folder', title: 'Add a rule whose folder you pick or create', onclick: async () => {
          const key = await pickFolder(ctx.state.root, '', { heading: 'Folder for the new rule', verb: 'Add rule here' });
          if (key) addRule(newRule(), key);
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
