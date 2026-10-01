// Dragging rows to move or copy them, and dropping links from elsewhere to bookmark them.

import { isFolder, isBookmark } from '../../../lib/tree.js';
import { parseDroppedLinks } from '../../../lib/links.js';
import { view, searching, sorted } from './state.js';

const DRAG_TYPE = 'application/x-bookmark-manager-ids';
// Holding over a closed folder this long opens it.
const HOVER_OPEN_MS = 800;
// The top and bottom quarters of a folder row drop before or after it; the middle drops inside.
const FOLDER_EDGE = 0.25;

export function wireDragDrop(lib) {
  const { get, list } = lib;
  const rowOf = (e) => e.target.closest?.('.tree-row');
  let dragIds = null;
  let hoverTimer;
  let hoverId = null;

  const clearDrop = () => {
    for (const el of list.querySelectorAll('.drop-before, .drop-after, .drop-into')) el.classList.remove('drop-before', 'drop-after', 'drop-into');
  };
  const clearHover = () => {
    hoverId = null;
    clearTimeout(hoverTimer);
  };
  // Where a drop on this row would put things: before it, after it or inside it. Sorted views and search results only drop into folders.
  const dropZone = (e, el, n) => {
    const r = el.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const folder = isFolder(n);
    if (searching() || sorted() || lib.isRootFolder(n)) return folder ? 'into' : null;
    if (folder) return y < FOLDER_EDGE ? 'before' : y > 1 - FOLDER_EDGE ? 'after' : 'into';
    return y < 0.5 ? 'before' : 'after';
  };
  const placeFor = (n, zone) => {
    if (zone === 'into') return { parentId: n.id, index: null };
    if (zone === 'before') return { parentId: n.parentId, index: n.index };
    if (isFolder(n) && view.expanded.has(n.id) && n.children?.length) return { parentId: n.id, index: 0 };
    return { parentId: n.parentId, index: n.index + 1 };
  };
  const external = (dt) => ['text/x-moz-url', 'text/uri-list'].some((t) => dt.types.includes(t));

  list.addEventListener('dragstart', (e) => {
    const el = rowOf(e);
    if (!el) return;
    if (!view.selected.has(el.dataset.id)) {
      lib.selectOnly(el.dataset.id);
      lib.focusRow(el.dataset.id, false);
    }
    const ids = lib.movable(lib.topSelected());
    if (!ids.length) return e.preventDefault();
    dragIds = ids;
    const marks = ids.map(get).filter(isBookmark);
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    if (marks.length) {
      e.dataTransfer.setData('text/x-moz-url', marks.map((n) => `${n.url}\n${n.title || n.url}`).join('\n'));
      e.dataTransfer.setData('text/uri-list', marks.map((n) => n.url).join('\r\n'));
      e.dataTransfer.setData('text/plain', marks.map((n) => n.url).join('\n'));
    }
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  list.addEventListener('dragend', () => {
    dragIds = null;
    clearHover();
    clearDrop();
  });
  list.addEventListener('dragover', (e) => {
    const el = rowOf(e);
    clearDrop();
    if (!el || !(dragIds || external(e.dataTransfer))) return;
    const n = get(el.dataset.id);
    const zone = dropZone(e, el, n);
    if (!zone) return;
    const place = placeFor(n, zone);
    if (dragIds && !lib.canPlace(dragIds, place.parentId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = !dragIds || e.ctrlKey || e.metaKey ? 'copy' : 'move';
    el.classList.add(`drop-${zone}`);
    if (zone === 'into' && !searching() && !view.expanded.has(n.id)) {
      if (hoverId !== n.id) {
        hoverId = n.id;
        clearTimeout(hoverTimer);
        // A redraw during the hover replaces this list, and the new one starts its own timer.
        hoverTimer = setTimeout(() => list.isConnected && lib.setOpen(n.id, true), HOVER_OPEN_MS);
      }
    } else clearHover();
  });
  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) {
      clearDrop();
      clearHover();
    }
  });
  list.addEventListener('drop', (e) => {
    const el = rowOf(e);
    clearDrop();
    clearTimeout(hoverTimer);
    if (!el) return;
    e.preventDefault();
    const n = get(el.dataset.id);
    const zone = dropZone(e, el, n);
    if (!zone) return;
    const place = placeFor(n, zone);
    const ids = dragIds;
    dragIds = null;
    if (ids) {
      if (!lib.canPlace(ids, place.parentId)) return;
      if (e.ctrlKey || e.metaKey) lib.copyTo(ids, place);
      else lib.moveTo(ids, place);
      return;
    }
    // Links dragged in from a page, a tab or the address bar become new bookmarks.
    const links = parseDroppedLinks(e.dataTransfer.getData('text/x-moz-url'), e.dataTransfer.getData('text/uri-list'));
    if (links.length) lib.create(links.map((p) => ({ type: 'bookmark', ...p })), `Added ${links.length} dropped link(s)`, `Added ${links.length} bookmark(s).`, place);
  });
}
