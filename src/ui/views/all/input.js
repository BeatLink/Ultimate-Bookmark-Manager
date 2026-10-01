// Mouse and keyboard handling for the tree, as in Firefox's Library.

import { ROOT, isFolder, isBookmark } from '../../../lib/tree.js';
import { view, searching } from './state.js';

// Letters typed within this long of each other jump to a name starting with all of them.
const TYPEAHEAD_MS = 800;
// Ctrl+V waits this long for a paste event with text from elsewhere before pasting the tree's own clipboard.
const PASTE_WAIT_MS = 50;
// A row's height when none is on screen to measure, for paging.
const ROW_HEIGHT_PX = 28;
// Where the keyboard-opened context menu appears, in from the focused row's left edge.
const MENU_INSET_PX = 24;

export function wireInput(lib) {
  const { get, list } = lib;
  const rowOf = (e) => e.target.closest?.('.tree-row');

  // ---- Mouse ----
  list.addEventListener('mousedown', (e) => {
    const el = rowOf(e);
    if (!el || e.button !== 0) return;
    const id = el.dataset.id;
    if (e.target.closest('.twisty') && isFolder(get(id)) && !searching()) {
      e.preventDefault();
      view.focus = id;
      lib.setOpen(id, !view.expanded.has(id));
      lib.focusRow(id, false);
      return;
    }
    // A plain press on an already selected row waits for the click, so several rows can be dragged together.
    if (e.ctrlKey || e.metaKey) lib.toggleSelected(id);
    else if (e.shiftKey) lib.selectTo(id);
    else if (!view.selected.has(id)) lib.selectOnly(id);
    if (e.shiftKey) e.preventDefault();
    lib.focusRow(id, false);
  });
  list.addEventListener('click', (e) => {
    const el = rowOf(e);
    if (!el || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('.twisty')) return;
    if (view.selected.size > 1 && view.selected.has(el.dataset.id)) {
      lib.selectOnly(el.dataset.id);
      lib.paint();
    }
  });
  list.addEventListener('dblclick', (e) => {
    const el = rowOf(e);
    if (el && !e.target.closest('.twisty')) lib.activate(el.dataset.id);
  });
  list.addEventListener('auxclick', (e) => {
    const el = rowOf(e);
    if (!el || e.button !== 1) return;
    e.preventDefault();
    const n = get(el.dataset.id);
    // A folder opens every bookmark directly inside it, as on the bookmarks toolbar.
    if (isBookmark(n)) lib.open([n.url], 'tab');
    else if (isFolder(n)) lib.open(lib.folderUrls(n.id), 'tab');
  });
  list.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const el = rowOf(e);
    if (el && !view.selected.has(el.dataset.id)) lib.selectOnly(el.dataset.id);
    if (!el) lib.selectOnly(null);
    if (el) lib.focusRow(el.dataset.id, false);
    else lib.paint();
    lib.contextMenu(e.clientX, e.clientY);
  });
  list.addEventListener('focusin', () => { view.active = true; });
  list.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !list.contains(e.relatedTarget) && !e.relatedTarget.closest('dialog')) view.active = false;
  });

  // ---- Keyboard ----
  let typed = '';
  let typedTimer;
  let pasteSeen = false;
  // Moves the focus to row `i`, extending the selection with Shift and leaving it alone with Ctrl.
  const step = (i, e) => {
    if (!lib.rows.length) return;
    const id = lib.rows[Math.max(0, Math.min(lib.rows.length - 1, i))].node.id;
    if (e.shiftKey) lib.selectTo(id);
    else if (!(e.ctrlKey || e.metaKey)) lib.selectOnly(id);
    lib.focusRow(id);
  };
  const pageSize = () => Math.max(1, Math.floor(innerHeight / (list.querySelector('.tree-row')?.offsetHeight || ROW_HEIGHT_PX)) - 2);
  // Typing jumps to the next row whose name starts with the letters typed so far.
  const typeAhead = (key, at) => {
    clearTimeout(typedTimer);
    typedTimer = setTimeout(() => { typed = ''; }, TYPEAHEAD_MS);
    typed += key.toLowerCase();
    const from = typed.length === 1 ? at + 1 : Math.max(at, 0);
    const order = [...lib.rows.slice(from), ...lib.rows.slice(0, from)];
    const hit = order.find((r) => (r.node.title || r.node.url || '').toLowerCase().startsWith(typed));
    if (hit) step(lib.indexOf(hit.node.id), {});
  };
  const menuFromKeyboard = () => {
    const r = (view.focus && lib.rowEl(view.focus))?.getBoundingClientRect() ?? list.getBoundingClientRect();
    if (view.focus && !view.selected.has(view.focus)) {
      lib.selectOnly(view.focus);
      lib.paint();
    }
    lib.contextMenu(r.left + MENU_INSET_PX, r.top + r.height / 2);
  };
  // Ctrl+V lets the paste event below see text copied elsewhere; if Firefox sends none, the tree's own clipboard is pasted.
  const pasteShortcut = () => {
    pasteSeen = false;
    setTimeout(() => { if (!pasteSeen) lib.paste(); }, PASTE_WAIT_MS);
    return false;
  };

  // Keys that move or act on the focused row; each returns false to let the browser handle the key after all.
  const navKeys = (at, cur, e) => ({
    ArrowDown: () => step(at + 1, e),
    ArrowUp: () => step(at < 0 ? 0 : at - 1, e),
    Home: () => step(0, e),
    End: () => step(lib.rows.length - 1, e),
    PageDown: () => step(at + pageSize(), e),
    PageUp: () => step(at - pageSize(), e),
    ArrowRight: () => {
      if (!cur || !isFolder(cur) || searching()) return false;
      if (!view.expanded.has(cur.id)) { lib.setOpen(cur.id, true); lib.focusRow(cur.id); }
      else if (lib.rows[at + 1]?.node.parentId === cur.id) step(at + 1, e);
    },
    ArrowLeft: () => {
      if (!cur || searching()) return false;
      if (isFolder(cur) && view.expanded.has(cur.id)) { lib.setOpen(cur.id, false); lib.focusRow(cur.id); }
      else if (cur.parentId !== ROOT) step(lib.indexOf(cur.parentId), e);
    },
    Enter: () => {
      if (!cur) return false;
      if (e.altKey) lib.properties(cur.id);
      else lib.activate(cur.id, e.shiftKey ? 'window' : e.ctrlKey || e.metaKey ? 'tab' : undefined);
    },
    F2: () => (cur ? lib.properties(cur.id) : false),
    Delete: () => lib.remove(lib.topSelected()),
    ContextMenu: menuFromKeyboard,
    '*': () => (cur && isFolder(cur) && !searching() ? lib.openBelow(cur.id) : false),
  });
  // Shortcuts with Ctrl (or ⌘), by the lower-cased letter.
  const ctrlKeys = (cur, e) => ({
    a: lib.selectAll,
    x: () => lib.toClipboard('cut'),
    c: () => lib.toClipboard('copy'),
    v: pasteShortcut,
    y: lib.redo,
    z: () => (e.shiftKey ? lib.redo() : lib.undo()),
    ' ': () => { if (!cur) return false; lib.toggleSelected(cur.id); lib.paint(); },
  });

  list.addEventListener('keydown', (e) => {
    if (e.target.closest('.tree-row') === null && e.target !== list) return;
    const at = lib.indexOf(view.focus);
    const cur = get(view.focus);
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    let handler = ctrl ? ctrlKeys(cur, e)[key.toLowerCase()] : null;
    handler ??= key === 'F10' && e.shiftKey ? menuFromKeyboard : navKeys(at, cur, e)[key];
    if (!handler && key.length === 1 && !ctrl && !e.altKey && key !== ' ') handler = () => typeAhead(key, at);
    if (handler && handler() !== false) e.preventDefault();
  });
  list.addEventListener('paste', (e) => {
    pasteSeen = true;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (view.clipboard && (!text || text === view.clipboard.text)) lib.paste();
    else if (!lib.pasteText(text) && view.clipboard) lib.paste();
  });
}
