// The editor for a rule's conditions, drawn in the markup and layout of react-querybuilder, whose query format rules use.

import { h } from './dom.js';
import { OPERATORS, FIELDS, FIELD_OPERATORS, WORD_OPS, FOLDER_OPS, newCondition, isGroup } from '../lib/organize.js';
import { parentOf, itemAt, withIds, newEditorGroup, moveItem, groupItems, insertItem, addItem, removeItem, canDropOnCondition, canDropOnGroup, dropPath } from '../lib/query-tree.js';
import { pickFolder } from './components.js';

const PLACEHOLDERS = { matchesRegex: 'Pattern', onDomain: 'example.com', hasParam: 'v or list=PL123' };

// "none" and "not all" are the `not` flag on an "any" or "all" group.
const RULE_SETTINGS = {
  any: { combinator: 'or', not: false },
  all: { combinator: 'and', not: false },
  none: { combinator: 'or', not: true },
  'not all': { combinator: 'and', not: true },
};

const ITEM = '[data-rule-id], [data-rule-group-id]';

// The item being dragged, shared by every open editor so a condition can be dragged from one rule into another.
let dragging = null;
// The drop target under the pointer and the classes that mark it.
let marks = [];

function mark(next) {
  for (const [el, cls] of marks) el.classList.remove(cls);
  marks = next;
  for (const [el, cls] of marks) el.classList.add(cls);
}

// Keys held down; browsers send no key presses mid-drag, so Alt (copy) and Ctrl (group) count when held before it starts.
const held = new Set();
const MODIFIERS = new Set(['shift', 'alt', 'meta', 'mod', 'ctrl']);
const CODES = { ShiftLeft: 'shift', ShiftRight: 'shift', AltLeft: 'alt', AltRight: 'alt', MetaLeft: 'meta', MetaRight: 'meta', OSLeft: 'meta', OSRight: 'meta', ControlLeft: 'ctrl', ControlRight: 'ctrl' };
const keyName = (key) => (CODES[key] ?? key ?? '').trim().toLowerCase().replace(/key|digit|numpad|arrow/, '');
document.addEventListener('keydown', (e) => {
  if (e.key === undefined) return;
  // With Meta down, browsers send no key-up for other keys, so those are forgotten at the next press.
  if (held.has('meta')) for (const k of held) if (!MODIFIERS.has(k)) held.delete(k);
  held.add(keyName(e.key));
  held.add(keyName(e.code));
});
document.addEventListener('keyup', (e) => {
  if (e.key === undefined) return;
  held.delete(keyName(e.key));
  held.delete(keyName(e.code));
});
window.addEventListener('blur', () => held.clear());
const copying = () => held.has('alt');
const grouping = () => held.has('ctrl');

// While a condition is dragged, anywhere that does not take it shows the "no drop" pointer.
document.addEventListener('dragover', (e) => {
  if (!dragging || e.defaultPrevented) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'none';
});

// Buttons that add, copy or remove keep their clicks from reaching the rule card around them.
const own = (fn) => (e) => {
  e.preventDefault();
  e.stopPropagation();
  fn();
};

// The focused control, as the id of its condition or group and its place among that item's own controls.
function controlsOf(item) {
  return [...item.querySelectorAll('button, select, input')].filter((c) => c.closest(ITEM) === item);
}

function focusSpot(box) {
  const el = document.activeElement;
  const item = box.contains(el) && el.closest(ITEM);
  return item ? { id: item.dataset.ruleId ?? item.dataset.ruleGroupId, index: controlsOf(item).indexOf(el) } : null;
}

function refocus(box, spot) {
  const id = spot && CSS.escape(spot.id);
  const item = id && box.querySelector(`[data-rule-id="${id}"], [data-rule-group-id="${id}"]`);
  if (item) controlsOf(item)[spot.index]?.focus();
}

// Shows `query` in `element`, reports each change, and returns a function that takes the editor down again.
export function mountQueryEditor(element, query, onChange, { root, moveToNewRule }) {
  const editor = { query: withIds(structuredClone(query)) };

  // Redraws the editor, keeping focus on the same control, and reports the new query.
  const commit = () => {
    const spot = focusSpot(element);
    draw();
    refocus(element, spot);
    onChange(editor.query);
  };
  editor.remove = (path) => removeItem(editor.query, path) && commit();

  const dragHandle = (path) => h('span', {
    class: 'queryBuilder-dragHandle', title: 'Drag to move, into another group too', text: '⠿', draggable: 'true',
    ondragstart: (e) => {
      const item = e.currentTarget.closest('.rule, .ruleGroup');
      const box = item.getBoundingClientRect();
      dragging = { editor, path, item };
      e.dataTransfer.setData('application/x-rule-condition', item.dataset.ruleId ?? item.dataset.ruleGroupId);
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setDragImage(item, e.clientX - box.left, e.clientY - box.top);
      // Faded only after the browser has taken its picture of the item.
      setTimeout(() => item.classList.add('dndDragging'));
    },
    ondragend: () => {
      dragging?.item.classList.remove('dndDragging');
      dragging = null;
      mark([]);
    },
  });

  // A drop lands after a condition or first in a group, as a copy with Alt, or grouped with the target with Ctrl.
  const dropTarget = (el, path, kind) => {
    // Anything from another rule's editor may land anywhere, except grouped with the top group.
    const allowed = (from) => {
      if (from.editor !== editor) return !(kind === 'group' && grouping() && !path.length);
      return kind === 'group' ? canDropOnGroup(from.path, path, grouping()) : canDropOnCondition(from.path, path, grouping());
    };
    const hover = (e) => {
      if (!dragging) return;
      if (!allowed(dragging)) return mark([[el, 'dndDropNotAllowed']]);
      e.preventDefault();
      // The pointer shows a copy while Alt is down now; what the drop does follows the keys held before the drag.
      e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
      mark([[el, 'dndOver'], copying() && [el, 'dndCopy'], grouping() && [kind === 'group' ? el.parentElement : el, 'dndGroup']].filter(Boolean));
    };
    el.addEventListener('dragenter', hover);
    el.addEventListener('dragover', hover);
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) mark(marks.filter(([node]) => node !== el && node !== el.parentElement));
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      mark([]);
      const from = dragging;
      dragging = null;
      if (!from || !allowed(from)) return;
      from.item.classList.remove('dndDragging');
      const copy = copying();
      const to = dropPath(path, kind, grouping());
      if (from.editor === editor) {
        if (grouping() ? groupItems(editor.query, from.path, to, copy) : moveItem(editor.query, from.path, to, copy)) commit();
        return;
      }
      const item = structuredClone(itemAt(from.editor.query, from.path));
      if (grouping()) {
        addItem(editor.query, item);
        groupItems(editor.query, [editor.query.rules.length - 1], to);
      } else {
        insertItem(editor.query, item, to);
      }
      commit();
      if (!copy) from.editor.remove(from.path);
    });
  };

  const copyButton = (cls, title, path) => h('button', { type: 'button', class: `${cls} small`, title, text: '⧉', onclick: own(() => moveItem(editor.query, path, [...parentOf(path), path.at(-1) + 1], true) && commit()) });

  const moveButton = (item) => h('button', {
    type: 'button', class: 'small', title: 'Move this into a new rule with the same destination, folders and ranking', 'aria-label': 'Move to a new rule', text: '↗',
    onclick: () => moveToNewRule(item.id),
  });

  const removeButton = (path) => h('button', {
    type: 'button', class: 'small keyword-remove', title: 'Remove condition', 'aria-label': 'Remove condition', text: '×',
    onclick: () => editor.remove(path),
  });

  // Changing the field sets the operator to "contains" and keeps the keyword, unless switching to or from a folder.
  const fieldSelect = (c) => h('select', {
    class: 'rule-fields', 'aria-label': 'Field',
    onchange: (e) => {
      const field = e.target.value;
      if (field === c.field) return;
      if ((field === 'folder') !== (c.field === 'folder')) c.value = '';
      c.field = field;
      c.operator = FIELD_OPERATORS[field].includes('contains') ? 'contains' : FIELD_OPERATORS[field][0];
      commit();
    },
  }, Object.entries(FIELDS).map(([name, label]) => h('option', { value: name, text: label, selected: name === c.field })));

  const operatorSelect = (c) => h('select', {
    class: 'rule-operators', title: 'Operator',
    onchange: (e) => {
      if (e.target.value === c.operator) return;
      c.operator = e.target.value;
      commit();
    },
  }, FIELD_OPERATORS[c.field].map((op) => h('option', { value: op, text: OPERATORS[op], selected: op === c.operator })));

  // The case and whole-word switches; one that does not apply keeps its place, so every row's columns line up.
  const switches = (c) => {
    const caseApplies = c.operator !== 'onDomain' && !FOLDER_OPS.has(c.operator);
    const wordsApply = WORD_OPS.has(c.operator);
    const flag = (prop, label, applies) => h('input', {
      type: 'checkbox', 'aria-label': label, disabled: !applies, checked: !!c[prop],
      onchange: (e) => {
        if (c[prop] === e.target.checked) return;
        c[prop] = e.target.checked;
        onChange(editor.query);
      },
    });
    return [
      h('label', { class: `check-line small rule-case${caseApplies ? '' : ' unused'}`, title: 'Match upper and lower case exactly' },
        flag('caseSensitive', 'Match case', caseApplies), 'Aa'),
      h('label', { class: `check-line small rule-words${wordsApply ? '' : ' unused'}`, title: 'Only match whole words, so “cat” does not match “category”' },
        flag('wholeWords', 'Whole words', wordsApply), 'Whole words'),
    ];
  };

  // A folder condition's folder, chosen with the page's folder picker; any other condition's keyword.
  const valueEditor = (c, path) => {
    if (FOLDER_OPS.has(c.operator)) {
      return h('span', { class: 'rule-value' },
        h('span', { class: 'keyword-with-remove' },
          h('button', {
            type: 'button', class: `folder-button${c.value ? '' : ' unset'}`, 'aria-label': 'Folder',
            onclick: async () => {
              const picked = await pickFolder(root, c.value ?? '', { heading: 'Choose a folder', verb: 'Folder', allowCreate: false });
              if (!picked || picked === c.value) return;
              c.value = picked;
              commit();
            },
          }, h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), c.value ? c.value.split('/').join(' › ') : 'Choose folder…'),
          removeButton(path)),
        switches(c));
    }
    return h('span', { class: 'rule-value' },
      h('span', { class: 'keyword-with-remove' },
        h('input', {
          type: 'text', class: `keyword${c.operator === 'matchesRegex' ? ' mono' : ''}`, 'aria-label': 'Keyword', value: c.value ?? '',
          placeholder: PLACEHOLDERS[c.operator] ?? 'Keyword',
          oninput: (e) => {
            if (e.target.value === c.value) return;
            c.value = e.target.value;
            onChange(editor.query);
          },
        }),
        removeButton(path)),
      switches(c));
  };

  const condition = (c, path) => {
    const el = h('div', { class: 'rule', 'data-rule-id': c.id, 'data-level': path.length, 'data-path': JSON.stringify(path) },
      dragHandle(path),
      fieldSelect(c),
      operatorSelect(c),
      valueEditor(c, path),
      copyButton('rule-cloneRule', 'Add a copy of this condition', path),
      moveButton(c));
    dropTarget(el, path, 'condition');
    return el;
  };

  const group = (g, path) => {
    const nested = path.length > 0;
    const current = Object.keys(RULE_SETTINGS).find((k) => RULE_SETTINGS[k].combinator === g.combinator && RULE_SETTINGS[k].not === !!g.not) ?? 'any';
    const header = h('div', { class: 'ruleGroup-header' },
      nested && dragHandle(path),
      h('select', {
        class: 'ruleGroup-combinators', 'aria-label': nested ? 'Group rule' : 'Rule',
        onchange: (e) => {
          Object.assign(g, RULE_SETTINGS[e.target.value]);
          commit();
        },
      }, Object.keys(RULE_SETTINGS).map((k) => h('option', { value: k, text: k, selected: k === current }))),
      h('button', { type: 'button', class: 'ruleGroup-addRule small', title: 'Add a condition', text: '+ Condition', onclick: own(() => { g.rules.push(newCondition()); commit(); }) }),
      h('button', { type: 'button', class: 'ruleGroup-addGroup small', title: 'Add a group with its own rule setting', text: '+ Group', onclick: own(() => { g.rules.push(newEditorGroup()); commit(); }) }),
      nested && [
        copyButton('ruleGroup-cloneGroup', 'Add a copy of this group', path),
        moveButton(g),
        h('button', { type: 'button', class: 'ruleGroup-remove small', title: 'Remove group', text: 'Remove group', onclick: own(() => editor.remove(path)) }),
      ]);
    dropTarget(header, path, 'group');
    return h('div', {
      title: nested ? `Rule group at path ${path.join('-')}` : 'Query builder', class: 'ruleGroup', 'data-not': g.not ? 'true' : null,
      'data-rule-group-id': g.id, 'data-level': path.length, 'data-path': JSON.stringify(path),
    }, header, h('div', { class: 'ruleGroup-body' }, g.rules.map((item, i) => (isGroup(item) ? group(item, [...path, i]) : condition(item, [...path, i])))));
  };

  const draw = () => element.replaceChildren(h('div', {
    role: 'form', class: 'queryBuilder query-editor queryBuilder-branches', 'data-dnd': 'enabled', 'data-inlinecombinators': 'disabled',
  }, group(editor.query, [])));

  draw();
  return () => {
    if (dragging?.editor === editor) dragging = null;
    element.replaceChildren();
  };
}
