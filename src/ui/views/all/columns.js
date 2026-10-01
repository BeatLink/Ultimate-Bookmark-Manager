// The tree's columns after Name, how each sorts, and the menu that chooses which to show.

import { h, formatDate, toast, menuBelow } from '../../dom.js';
import { nodeType } from '../../../lib/tree.js';
import { byText } from '../../../lib/text.js';
import { askPermission } from '../../permissions.js';
import { view, saveColumns, searching } from './state.js';
import { visitOf, loadVisits } from './visits.js';

const SORTERS = {
  title: (a, b) => byText(a.title ?? '', b.title ?? ''),
  url: (a, b) => (a.url ?? '').localeCompare(b.url ?? ''),
  dateAdded: (a, b) => (a.dateAdded ?? 0) - (b.dateAdded ?? 0),
  visited: (a, b) => (visitOf(a)?.last ?? 0) - (visitOf(b)?.last ?? 0),
  visits: (a, b) => (visitOf(a)?.count ?? 0) - (visitOf(b)?.count ?? 0),
};

// The columns after Name, in order; `where` shows only in search results.
const COLUMNS = [
  { key: 'location', label: 'Location', sort: 'url', width: 'minmax(10em, 3fr)', text: (n) => n.url ?? '' },
  { key: 'where', label: 'Folder', width: 'minmax(8em, 2fr)' },
  { key: 'added', label: 'Added', sort: 'dateAdded', width: '7.5em', text: (n) => (nodeType(n) === 'separator' ? '' : formatDate(n.dateAdded)) },
  { key: 'visited', label: 'Most recent visit', sort: 'visited', width: '9em', text: (n) => formatDate(visitOf(n)?.last) },
  { key: 'visits', label: 'Visit count', sort: 'visits', width: '5.5em', text: (n) => (n.url ? String(visitOf(n)?.count ?? 0) : ''), num: true },
];

export const shownColumns = () => COLUMNS.filter((c) => (c.key === 'where' ? searching() : view.columns[c.key]));
export const showsVisits = () => view.columns.visited || view.columns.visits;

// The comparison the current sort applies, direction included.
export const sortOrder = () => (a, b) => SORTERS[view.sort.key](a, b) * view.sort.dir;

// A column heading that sorts the view: once ascending, again descending, a third time back to the saved order.
export function sortButton(key, label, draw) {
  const on = view.sort.key === key;
  return h('button', {
    type: 'button', class: `col-sort${on ? ' on' : ''}`, 'aria-sort': on ? (view.sort.dir > 0 ? 'ascending' : 'descending') : null,
    title: on ? (view.sort.dir > 0 ? 'Sorted A to Z; select to reverse' : 'Sorted Z to A; select to show the saved order') : `Sort the view by ${label.toLowerCase()}`,
    onclick: () => {
      if (!on) view.sort = { key, dir: 1 };
      else if (view.sort.dir > 0) view.sort = { key, dir: -1 };
      else view.sort = { key: null, dir: 1 };
      draw();
    },
  }, label, on && h('span', { 'aria-hidden': 'true', text: view.sort.dir > 0 ? ' ▲' : ' ▼' }));
}

// The menu under the Columns button; the visit columns ask for history permission the first time they are turned on.
export function columnsMenu(button, draw) {
  const toggle = async (key) => {
    const on = !view.columns[key];
    if (on && (key === 'visited' || key === 'visits') && !(await askPermission('history'))) return toast('Visit columns need permission to read your browsing history.', 'error');
    view.columns[key] = on;
    if (!on && view.sort.key === COLUMNS.find((c) => c.key === key).sort) view.sort = { key: null, dir: 1 };
    saveColumns();
    if (showsVisits()) loadVisits().then(draw);
    draw();
  };
  menuBelow(button, COLUMNS.filter((c) => c.key !== 'where').map((c) => ({ label: c.label, checked: view.columns[c.key], run: () => toggle(c.key) })));
}
