// Changes to a rule's tree of groups and conditions, addressed by path: the indexes leading down from the top group.

import { isGroup, renumber, newCondition } from './organize.js';

export const parentOf = (path) => path.slice(0, -1);

export const samePath = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// True when `path` lies inside the item at `ancestor`.
export const isAncestor = (ancestor, path) => ancestor.length < path.length && ancestor.every((x, i) => x === path[i]);

// The group or condition at `path`, or null when there is none.
export function itemAt(query, path) {
  let item = query;
  for (const i of path) {
    if (!isGroup(item)) return null;
    item = item.rules[i];
  }
  return item ?? null;
}

// Gives every group and condition without an id a new one.
export function withIds(item) {
  if (!item.id) item.id = crypto.randomUUID();
  if (isGroup(item)) item.rules.forEach(withIds);
  return item;
}

// A new group as the "+ Group" button adds it: "all" of one empty keyword condition.
export function newEditorGroup() {
  return { id: crypto.randomUUID(), rules: [newCondition()], combinator: 'and', not: false };
}

// Where `to` points once the item at `from` has been taken out of the tree.
function afterRemoving(from, to) {
  const out = [...to];
  const a = parentOf(from);
  const b = parentOf(to);
  let depth = 0;
  while (depth < a.length && depth < b.length && a[depth] === b[depth]) depth++;
  if (from.length === depth + 1 && out[depth] > from[depth]) out[depth] -= 1;
  return out;
}

// Whether the item at `from` can go to `to`: not the top group, not where it already is, and not inside itself.
function canMove(query, from, to, copy) {
  return from.length > 0 && !samePath(from, to) && isGroup(itemAt(query, parentOf(to))) && (copy || !isAncestor(from, to));
}

// Moves the item at `from`, or with `copy` a copy of it, so it ends up at `to`; false when nothing changed.
export function moveItem(query, from, to, copy = false) {
  const item = itemAt(query, from);
  if (!item || !canMove(query, from, to, copy)) return false;
  if (!copy) itemAt(query, parentOf(from)).rules.splice(from.at(-1), 1);
  const at = copy ? to : afterRemoving(from, to);
  itemAt(query, parentOf(at)).rules.splice(at.at(-1), 0, copy ? renumber(item) : item);
  return true;
}

// Puts the item at `from`, or with `copy` a copy of it, in a new "all" group with the item at `to`, where that item was.
export function groupItems(query, from, to, copy = false) {
  const source = itemAt(query, from);
  const target = itemAt(query, to);
  if (!source || !target || !to.length || !canMove(query, from, to, copy)) return false;
  if (!copy) itemAt(query, parentOf(from)).rules.splice(from.at(-1), 1);
  const at = copy ? to : afterRemoving(from, to);
  itemAt(query, parentOf(at)).rules.splice(at.at(-1), 1, { combinator: 'and', rules: [target, copy ? renumber(source) : source], id: crypto.randomUUID() });
  return true;
}

// Places a copy of an item from another rule at `path`, under new ids.
export function insertItem(query, item, path) {
  const parent = itemAt(query, parentOf(path));
  if (!isGroup(parent)) return false;
  parent.rules.splice(path.at(-1), 0, renumber(item));
  return true;
}

// Adds an item from another rule at the end of the top group, keeping its ids.
export function addItem(query, item) {
  query.rules.push(withIds(item));
}

export function removeItem(query, path) {
  if (!path.length || !itemAt(query, path)) return false;
  itemAt(query, parentOf(path)).rules.splice(path.at(-1), 1);
  return true;
}

// Whether an item from `from` may drop on the condition at `onto`; not on the one just before it, unless grouping.
export function canDropOnCondition(from, onto, grouping) {
  if (isAncestor(from, onto) || samePath(from, onto)) return false;
  return grouping || !samePath(parentOf(onto), parentOf(from)) || onto.at(-1) !== from.at(-1) - 1;
}

// Whether an item from `from` may drop on the header of the group at `onto`; nothing groups with the top group.
export function canDropOnGroup(from, onto, grouping) {
  if (grouping && !onto.length) return false;
  return !(isAncestor(from, onto) || samePath(onto, from) || (samePath(onto, parentOf(from)) && from.at(-1) === 0));
}

// Where a dropped item goes: after a condition, first in a group, or, while grouping, in place of the target.
export function dropPath(onto, kind, grouping) {
  if (grouping) return onto;
  return kind === 'group' ? [...onto, 0] : [...parentOf(onto), onto.at(-1) + 1];
}
