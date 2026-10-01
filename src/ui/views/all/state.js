// What the All bookmarks page remembers between renders: search, open folders, selection, sorting and the clipboard.

import { PAGE } from '../../components.js';
import { MENU, TOOLBAR, OTHER } from '../../../lib/tree.js';

const EXPANDED_KEY = 'all.expanded';
const COLUMNS_KEY = 'all.columns';

const loadExpanded = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPANDED_KEY));
    if (Array.isArray(saved)) return new Set(saved);
  } catch { /* storage may be unavailable */ }
  return new Set([MENU, TOOLBAR, OTHER]);
};

const loadColumns = () => {
  const columns = { location: true, added: true, visited: false, visits: false };
  try {
    Object.assign(columns, JSON.parse(localStorage.getItem(COLUMNS_KEY)));
  } catch { /* storage may be unavailable */ }
  return columns;
};

export const view = {
  query: '', filter: 'all', shown: PAGE,
  expanded: loadExpanded(),
  columns: loadColumns(),
  selected: new Set(), focus: null, anchor: null,
  sort: { key: null, dir: 1 },
  clipboard: null,
  // True while the tree has the keyboard, so a re-render gives the focused row back its focus.
  active: false,
};

export const saveExpanded = () => {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...view.expanded]));
  } catch { /* storage may be unavailable */ }
};

export const saveColumns = () => {
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(view.columns));
  } catch { /* storage may be unavailable */ }
};

export const searching = () => view.query.trim() !== '' || view.filter !== 'all';
export const sorted = () => view.sort.key !== null;

// Starts a fresh search or filter from the first page of results.
export function setSearch(query, filter = 'all') {
  Object.assign(view, { query, filter, shown: PAGE });
}

// Opens this page with the search box filled in or a filter chosen, e.g. a site or "recently added" on the dashboard.
export function showInAll(ctx, query, filter = 'all') {
  setSearch(query, filter);
  view.sort = { key: null, dir: 1 };
  ctx.go('all');
}
