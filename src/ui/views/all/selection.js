// Which rows are selected, and where one id sits in relation to another.

import { ROOT_IDS } from '../../../lib/tree.js';
import { view } from './state.js';

export function selectionOf(lib) {
  const { get } = lib;

  // True when the item, or something holding it, is one of the given ids.
  const within = (id, ids) => {
    for (let n = get(id); n; n = get(n.parentId)) if (ids.has(n.id)) return true;
    return false;
  };
  const inside = (id, ancestorId) => within(id, new Set([ancestorId]));

  // The selection without anything already inside a selected folder, in on-screen order.
  const topSelected = () => {
    const ids = view.selected;
    const order = new Map(lib.rows.map((r, i) => [r.node.id, i]));
    return [...ids].filter((id) => !within(get(id)?.parentId, ids)).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  };
  const movable = (ids) => ids.filter((id) => !ROOT_IDS.has(id));

  const selectOnly = (id) => {
    view.selected = new Set(id ? [id] : []);
    view.anchor = id;
  };
  const selectTo = (id) => {
    const a = lib.indexOf(view.anchor ?? id);
    const b = lib.indexOf(id);
    if (a < 0 || b < 0) return selectOnly(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    view.selected = new Set(lib.rows.slice(lo, hi + 1).map((r) => r.node.id));
  };
  const toggleSelected = (id) => {
    if (view.selected.has(id)) view.selected.delete(id);
    else view.selected.add(id);
    view.anchor = id;
  };
  const selectAll = () => {
    view.selected = new Set(lib.rows.map((r) => r.node.id));
    lib.paint();
  };

  return { within, inside, topSelected, movable, selectOnly, selectTo, toggleSelected, selectAll };
}
