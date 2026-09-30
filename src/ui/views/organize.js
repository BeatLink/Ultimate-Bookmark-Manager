// Organize rules: edit rules that file bookmarks into folders, preview the moves, then apply them.

import { h, Selection, toast, confirmDialog } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectAllToggle, bookmarkInfo, row, tagInput, pickFolder, marked } from '../components.js';
import { saveSettings } from '../../lib/settings.js';
import { WORD_OPS, ADDRESS_OPS, OPERATORS, FIELDS, MODES, newRule, newCatchAll, newCondition, newGroup, isGroup, keywords, duplicateRule, describeRule, planMoves, resolveTarget, maxScore } from '../../lib/organize.js';

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

function select(options, value, onchange, label) {
  return h('select', { 'aria-label': label, onchange: (e) => onchange(e.target.value) },
    Object.entries(options).map(([v, text]) => h('option', { value: v, text, selected: v === value })));
}

const PLACEHOLDERS = { regex: 'Type a pattern, press Enter', domain: 'example.com, press Enter', param: 'v or list=PL123, press Enter' };

function conditionRow(cond, onRemove, changed) {
  cond.values = keywords(cond);
  delete cond.value;
  const field = select(FIELDS, cond.field, (v) => { cond.field = v; changed(); }, 'Field');
  // Off, "cat" also matches inside "category"; on, only the word itself.
  const whole = h('label', { class: 'check-line small', title: 'Only match whole words, so “cat” does not match “category”', hidden: !WORD_OPS.has(cond.op) },
    h('input', { type: 'checkbox', checked: !!cond.wholeWords, 'aria-label': 'Whole words', onchange: (e) => { cond.wholeWords = e.target.checked; changed(); } }), 'Whole words');
  field.hidden = ADDRESS_OPS.has(cond.op);
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
      field.hidden = ADDRESS_OPS.has(v);
      whole.hidden = !WORD_OPS.has(v);
      const next = makeTags();
      tags.replaceWith(next);
      tags = next;
      changed();
    }, 'Operator'),
    tags,
    h('label', { class: 'check-line small', title: 'Match upper and lower case exactly' },
      h('input', { type: 'checkbox', checked: cond.caseSensitive, onchange: (e) => { cond.caseSensitive = e.target.checked; changed(); } }), 'Aa'),
    whole,
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

// The folders a rule looks in, as removable chips; with none it looks everywhere.
function sourcesPicker(ctx, rule, changed) {
  const chips = h('span', { class: 'row wrap source-list' });
  const subfolders = h('label', { class: 'check-line small' },
    h('input', { type: 'checkbox', checked: rule.sourceSubfolders !== false, onchange: (e) => { rule.sourceSubfolders = e.target.checked; changed(); } }),
    'and their subfolders');
  const draw = () => {
    const sources = rule.sources ?? [];
    chips.replaceChildren(...(sources.length ? sources.map((s, j) => h('span', { class: 'tag' },
      h('span', { class: 'tag-text', text: s.split('/').join(' › ') }),
      h('button', { class: 'tag-remove', text: '×', 'aria-label': `Stop looking in “${s}”`, onclick: () => { sources.splice(j, 1); draw(); changed(); } })))
      : [h('span', { class: 'muted', text: 'All folders' })]));
    subfolders.hidden = !sources.length;
  };
  const add = h('button', { class: 'small', type: 'button', text: '+ Folder', title: 'Only sort bookmarks that are in this folder', onclick: async () => {
    const picked = await pickFolder(ctx.state.root, '', { heading: 'Look in which folder?', verb: 'Look in', allowCreate: false });
    if (!picked) return;
    rule.sources ??= [];
    if (!rule.sources.includes(picked)) rule.sources.push(picked);
    draw();
    changed();
  } });
  draw();
  return h('div', { class: 'row wrap target' }, 'Look in', chips, add, subfolders);
}

// A group of conditions and nested groups; the rule itself is the outermost group, which cannot be removed.
function groupEditor(group, changed, onRemove) {
  const items = h('ul', { class: 'conditions' });
  const draw = () => items.replaceChildren(...group.conditions.map((item, j) => {
    const remove = () => { group.conditions.splice(j, 1); draw(); changed(); };
    return isGroup(item) ? h('li', { class: 'group-item' }, groupEditor(item, changed, remove)) : conditionRow(item, remove, changed);
  }));
  draw();
  const add = (item) => {
    group.conditions.push(item);
    draw();
    changed();
    items.lastElementChild?.querySelector('.tag-input input')?.focus();
  };
  return h('div', { class: `cond-group${onRemove ? ' nested' : ''}` },
    h('div', { class: 'row wrap' },
      onRemove ? null : 'When',
      select(MODES, group.match, (v) => { group.match = v; changed(); }, onRemove ? 'Group match' : 'Match'),
      'of these are true:',
      onRemove && h('button', { class: 'small group-remove', text: 'Remove group', onclick: onRemove })),
    items,
    h('div', { class: 'row wrap' },
      h('button', { class: 'small', text: '+ Condition', onclick: () => add(newCondition()) }),
      h('button', { class: 'small', text: '+ Group', title: 'Add a group with its own any / all / none setting', onclick: () => add(newGroup()) })));
}

// Rules shown open; saved rules start closed, while new and duplicated ones open for editing.
const expanded = new Set();
// Folders the user opened or closed by hand; the rest are open when they or a folder inside them hold rules.
const folderOpen = new Map();
// The folder search and the "only folders with rules" switch survive refreshes.
const treeView = { query: '', onlyWithRules: false };

const PART_NAMES = { title: 'title', url: 'address', host: 'site name', path: 'path', query: 'query string', fragment: 'part after #' };

// "“ccna” in title, “youtube.com” in address" for a rule's match explanation.
function matchedText(why) {
  return why.terms.map((t) => `“${t.value}” in ${t.on.map((o) => PART_NAMES[o] ?? o).join(' and ')}`).join(', ');
}

// Every rule that matched a bookmark, strongest first, each with its standing and, below the winner, why it lost.
// Selecting a rule re-highlights the bookmark's title and address with what that rule matched.
function rankingList(move) {
  const show = (r, button) => {
    const box = button.closest('.bm');
    const { title, url } = move.bookmark;
    const link = box.querySelector('.bm-title a');
    if (link && title) link.replaceChildren(...marked(title, r.why?.title));
    box.querySelector('.bm-url')?.replaceChildren(...marked(url, r.why?.url));
    const note = box.querySelector('.matched');
    if (note) note.hidden = false;
    if (note) note.textContent = r.why?.terms.length ? `${r.lost ? `${r.ruleName || 'Unnamed rule'} matched` : 'Matched'} ${matchedText(r.why)}` : `${r.ruleName || 'Unnamed rule'} is a catch-all: nothing to highlight`;
    for (const b of box.querySelectorAll('.ranking-pick')) b.setAttribute('aria-pressed', String(b === button));
  };
  // The list is only built the first time it is opened.
  const details = h('details', { class: 'ranking', ontoggle: () => {
    if (!details.open || details.childElementCount > 1) return;
    details.append(
      h('p', { class: 'small muted', text: 'Select a rule to highlight what it matched.' }),
      h('ol', {}, move.ranking.map((r) => h('li', { class: r.lost ? 'lost' : 'won' },
      h('button', { class: 'ranking-pick', type: 'button', 'aria-pressed': String(!r.lost), title: 'Highlight what this rule matched', onclick: (e) => show(r, e.currentTarget) },
        h('strong', { text: r.ruleName || 'Unnamed rule' }),
        h('span', { class: 'muted', text: ` → ${r.target.path.join(' › ')}` })),
      h('div', { class: 'small muted' },
        [r.priority ? `priority ${r.priority}` : '', r.catchAll ? 'catch-all' : r.fallback ? 'fallback' : '', r.catchAll ? '' : `specificity ${r.score}`,
          r.why?.terms.length ? `matched ${matchedText(r.why)}` : ''].filter(Boolean).join(' · ')),
      h('div', { class: 'small' }, r.lost ? h('span', { class: 'lost-reason', text: `Lost: ${r.lost}` }) : h('strong', { class: 'won-label', text: 'Wins' }))))));
  } }, h('summary', { text: `All ${move.others + 1} matching rules` }));
  return details;
}

// How many rows each preview group shows before a "Show more" button.
const PREVIEW_ROWS = 100;

const SPECIFICITY_HELP = 'Specificity if every condition matches (only the ones that match a bookmark count): exact address 1000, address path 100 + 10 per segment (+10 more when exact), exact query string 80, subdomain 60, query parameter with value 60, domain 50, exact title 40, query parameter 30, keyword 20, regex 15.';

// A rule as a one-line summary row that expands into its editor; `parts` receives the bits refreshed while editing.
function ruleCard(ctx, rule, rules, redraw, changed, parts) {
  const bodyId = `rule-body-${rule.id}`;
  const isOpen = expanded.has(rule.id);
  const priority = h('input', { type: 'number', step: 1, class: 'priority-input', value: String(Number(rule.priority) || 0), 'aria-label': 'Priority',
    oninput: (e) => { rule.priority = Math.round(Number(e.target.value)) || 0; changed(); } });
  const body = h('div', { class: 'rule-body', id: bodyId, hidden: !isOpen });
  // The editor is only built the first time the rule is opened.
  const fillBody = () => body.append(
    h('label', { class: 'row wrap' }, 'Name',
      h('input', { type: 'text', class: 'grow rule-name', value: rule.name, placeholder: 'Rule name (optional)', 'aria-label': 'Rule name', oninput: (e) => { rule.name = e.target.value; changed(); } })),
    sourcesPicker(ctx, rule, changed),
    rule.catchAll
      ? h('p', { class: 'muted small', text: 'Moves every bookmark in the folders above that no other rule matches. Any matching rule beats it unless you give this one a higher priority.' })
      : groupEditor(rule, changed, null),
    h('div', { class: 'row wrap target' }, 'Files into', targetPicker(ctx, rule, redraw)),
    !rule.catchAll && h('label', { class: 'check-line' },
      h('input', { type: 'checkbox', checked: !!rule.fallback, 'aria-label': 'Fallback', onchange: (e) => { rule.fallback = e.target.checked; redraw(); } }),
      h('span', {}, 'Fallback: only use this rule when no other rule matches',
        h('span', { class: 'muted small', text: ' — for broad sites like YouTube or Reddit, so a more specific rule (say, CCNA) wins for the pages it covers. Catch-alls still come after it.' }))),
    h('label', { class: 'row wrap' }, 'Priority', priority,
      h('span', { class: 'muted small', text: 'A higher priority always wins. Leave it at 0 to let the most specific match decide.' })),
    parts.info);
  if (isOpen) fillBody();

  const toggle = h('button', {
    class: 'rule-toggle', type: 'button', 'aria-expanded': String(isOpen), 'aria-controls': bodyId,
    title: isOpen ? 'Collapse' : 'Edit this rule',
    onclick: () => {
      const open = body.hidden;
      if (open && !body.childElementCount) fillBody();
      body.hidden = !open;
      open ? expanded.add(rule.id) : expanded.delete(rule.id);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.title = open ? 'Collapse' : 'Edit this rule';
      card.classList.toggle('open', open);
    },
  }, h('span', { class: 'chevron', 'aria-hidden': 'true' }),
  h('span', { class: 'rule-headline' }, parts.title, parts.summary, h('span', { class: 'rule-target' }, parts.target)));

  const card = h('li', { class: `rule-card${rule.enabled === false ? ' disabled' : ''}${isOpen ? ' open' : ''}${rule.catchAll ? ' catch-all' : ''}${rule.fallback && !rule.catchAll ? ' fallback' : ''}`, 'data-rule': rule.id },
    h('div', { class: 'rule-head' },
      h('input', { type: 'checkbox', checked: rule.enabled !== false, 'aria-label': 'Rule enabled', title: 'Enabled', onchange: (e) => { rule.enabled = e.target.checked; redraw(); } }),
      parts.score,
      toggle,
      parts.badge,
      h('div', { class: 'rule-actions' },
        h('button', { class: 'small', text: 'Duplicate', title: 'Add an editable copy of this rule', onclick: (e) => {
          const list = e.currentTarget.closest('.organize');
          const copy = duplicateRule(rule);
          expanded.add(copy.id);
          rules.splice(rules.indexOf(rule) + 1, 0, copy);
          redraw();
          const name = list.querySelector(`[data-rule="${copy.id}"] .rule-name`);
          name?.scrollIntoView?.({ block: 'nearest' });
          name?.focus();
          name?.select();
        } }),
        h('button', { class: 'small danger', text: 'Delete', onclick: () => { expanded.delete(rule.id); rules.splice(rules.indexOf(rule), 1); redraw(); } }))),
    body);
  return card;
}

// The bookmark folder tree, each node with its path key as rules store it ("Bookmarks Menu/Dev/Rust").
function folderTree(root) {
  const walk = (node, path, depth) => {
    const own = [...path, node.title ?? ''];
    return {
      id: node.id, title: node.title || '(no name)', key: own.join('/'), depth,
      children: (node.children ?? []).filter((c) => !c.url && c.children).map((c) => walk(c, own, depth + 1)),
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
      title: h('strong', { class: 'rule-title' }),
      summary: h('span', { class: 'rule-summary' }),
      target: h('span'),
      badge: h('span', { class: 'rule-badge' }),
      score: h('span', { class: 'score-chip' }),
    });
    const card = (r) => {
      const parts = newParts();
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
      el?.querySelector('.tag-input input, .folder-button')?.focus();
    };

    // The whole tree is rebuilt when rules are added, removed or moved; typing only refreshes the cards' text.
    const drawTree = () => {
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
          children.append(...[...own.filter((r) => !r.catchAll), ...own.filter((r) => r.catchAll)].map(card), ...kids.map(node));
        };
        if (open) fill();
        const countEl = h('span', { class: 'rule-badge active' });
        folderCounts.set(n.key, countEl);
        return h('li', { class: 'folder-node', 'data-folder': n.key },
          h('div', { class: 'folder-head', style: `--depth: ${n.depth}` },
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
              h('button', { class: 'small', text: '+ Catch-all', title: `File into ${n.title} whatever no other rule matches in a folder you choose`, onclick: () => {
                const unfiled = ctx.state.root.children.find((c) => c.id === 'unfiled_____')?.title;
                addRule(Object.assign(newCatchAll(unfiled ? [unfiled] : []), { name: 'Everything else' }), n.key);
              } }))),
          children);
      };

      const visible = tree.filter(shown);
      treeBox.replaceChildren(
        orphans.length > 0 && h('section', { class: 'orphan-rules' },
          h('h2', { text: 'Rules for folders that do not exist yet' }),
          h('p', { class: 'muted small', text: 'A missing folder is created when its rule first moves something into it. Rules still choosing a folder are here too.' }),
          h('ul', { class: 'folder-children' }, orphans.map(card))),
        visible.length ? h('ul', { class: 'folder-tree-list' }, visible.map(node)) : emptyState('No folders match.'));
    };

    const refresh = () => {
      const { moves, problems, wins, matches } = plan(ctx, rules);
      refreshInfo(moves, problems, wins, matches);
    };
    const refreshInfo = (moves, problems, wins, matches) => {
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
        parts.title.textContent = r.name || 'Unnamed rule';
        parts.title.classList.toggle('muted', !r.name);
        parts.summary.textContent = describeRule(r);
        const from = r.sources?.length ? `from ${r.sources.map((f) => f.split('/').join(' › ')).join(', ')} ` : '';
        parts.target.textContent = `${from}${r.target ? `→ ${r.target.split('/').join(' › ')}` : '→ no folder yet'}`;
        const p = Number(r.priority) || 0;
        const spec = maxScore(r);
        parts.score.textContent = `${p ? `P${p} · ` : ''}${r.catchAll ? 'catch-all' : `${r.fallback ? 'fallback · ' : ''}≤ ${spec}`}`;
        parts.score.title = `${p ? `Priority ${p}: beats every rule with a lower priority. ` : ''}${r.catchAll ? 'A catch-all loses to any matching rule of the same priority.'
          : `${r.fallback ? 'Fallback: loses to any normal rule that also matches, of the same priority; beats catch-alls. ' : ''}${SPECIFICITY_HELP}`}`;
        parts.score.classList.toggle('prioritised', p !== 0);
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
        parts.info.replaceChildren(h('p', { class: 'muted small', text: `Matches ${matched} bookmark(s) and wins ${won}: ${moves} would move, the rest are already in place.${matched > won ? ` ${matched - won} go to ${r.fallback ? 'a normal (non-fallback) rule, a rule with a higher priority, or a more specific match' : 'a rule with a higher priority or a more specific match'}.` : ''}` }));
        parts.badge.textContent = r.enabled === false ? 'Off' : `${moves} to move`;
        parts.badge.className = `rule-badge${moves && r.enabled !== false ? ' active' : ''}`;
        parts.badge.title = `Matches ${matched}, wins ${won}, ${moves} would move`;
      }
    };

    const drawPreview = () => {
      const { moves, problems, wins, matches } = plan(ctx, rules);
      refreshInfo(moves, problems, wins, matches);
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
          h('span', { text: `Rule: ${m.ruleName || 'unnamed'}${m.priority ? ` · priority ${m.priority}` : ''}${m.score >= 0 ? `${m.fallback ? ' · fallback' : ''} · specificity ${m.score}` : ' · catch-all'}${m.others ? ` · beat ${m.others} other matching rule(s)` : ''}` }),
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
      viewHeader('Organize', 'Each folder lists the rules that file bookmarks into it. When several rules match a bookmark, the highest priority wins, then normal rules over fallback rules over catch-alls, then the most specific match, then the newest rule. Bookmarks already inside the winning rule’s folder stay where they are.',
        dirtyNote,
        h('button', { class: 'small', text: 'Discard changes', onclick: () => { draft = null; ctx.render(); } }),
        h('button', { class: 'primary', text: 'Save rules', onclick: () => save() })),
      h('label', { class: 'check-line' },
        h('input', { type: 'checkbox', checked: draft.autoApply, onchange: (e) => { draft.autoApply = e.target.checked; changed(); } }),
        'Organize new bookmarks automatically (a few seconds after they are added; skipped if you pick a folder yourself or many arrive at once, as during an import or sync)'),
      h('div', { class: 'row wrap filters' },
        search,
        h('label', { class: 'check-line small' },
          h('input', { type: 'checkbox', checked: treeView.onlyWithRules, onchange: (e) => { treeView.onlyWithRules = e.target.checked; drawTree(); refresh(); } }),
          'Only folders with rules'),
        h('button', { class: 'small', text: 'Expand all', onclick: () => setAll(true) }),
        h('button', { class: 'small', text: 'Collapse all', onclick: () => setAll(false) }),
        h('button', { class: 'small', text: '+ Rule for a new folder', title: 'Add a rule whose folder you pick or create', onclick: () => addRule(newRule(), '') })),
      treeBox,
      previewBox);

    drawTree();
    drawPreview();
    dirtyNote.textContent = isDirty() ? 'Unsaved changes' : '';
    return section;
  },
};
