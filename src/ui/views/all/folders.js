// Opening and closing folders, and where new or moved items may go.

import { ROOT, OTHER, isFolder, pathTo } from '../../../lib/tree.js';
import { view, saveExpanded, searching } from './state.js';

export function foldersOf(lib) {
  const { byId, get } = lib;

  const isRootFolder = (n) => n.parentId === ROOT;

  const setOpen = (id, open) => {
    if (open === view.expanded.has(id)) return;
    if (open) view.expanded.add(id);
    else {
      view.expanded.delete(id);
      // Closing a folder hides what was selected inside it, so the folder takes over the focus.
      for (const s of [...view.selected]) if (s !== id && lib.inside(s, id)) view.selected.delete(s);
      if (view.focus && view.focus !== id && lib.inside(view.focus, id)) view.focus = id;
    }
    saveExpanded();
    lib.draw();
  };

  // Opens a folder and every folder above it.
  const revealFolder = (folderId) => {
    for (let n = get(folderId); n && n.id !== ROOT; n = get(n.parentId)) view.expanded.add(n.id);
    saveExpanded();
  };

  // Opens a folder and everything inside it.
  const openBelow = (folderId) => {
    const all = (n) => {
      if (!isFolder(n)) return;
      view.expanded.add(n.id);
      n.children?.forEach(all);
    };
    all(get(folderId));
    saveExpanded();
    lib.draw();
    lib.focusRow(folderId);
  };

  const setAllOpen = (open) => {
    if (open) for (const n of byId.values()) { if (isFolder(n) && n.id !== ROOT) view.expanded.add(n.id); }
    else view.expanded.clear();
    saveExpanded();
    // Closing everything leaves only the top-level folders, so the focus moves up to the one holding it.
    if (!open && view.focus && !isRootFolder(get(view.focus))) {
      let top = get(view.focus);
      while (top && !isRootFolder(top)) top = get(top.parentId);
      lib.selectOnly(top?.id ?? null);
      view.focus = top?.id ?? null;
    }
    lib.draw();
    if (view.focus) lib.focusRow(view.focus);
  };

  // Nothing can go straight into the root, or into itself.
  const canPlace = (ids, parentId) => parentId !== ROOT && !ids.some((id) => lib.inside(parentId, id));

  // A moved folder carries the paths it moves between, so organize rules naming it follow.
  const folderMove = (id, parentId) => {
    const n = get(id);
    return isFolder(n) ? { id, from: pathTo(byId, id), to: [...pathTo(byId, parentId), n.title ?? ''] } : { id };
  };

  // Where new things go: into an open folder at the top, otherwise just below the focused item; Other Bookmarks when nothing is focused.
  const insertionPoint = () => {
    const n = get(view.focus);
    if (!n) return { parentId: OTHER, index: null };
    if (isFolder(n) && (isRootFolder(n) || (!searching() && view.expanded.has(n.id)))) return { parentId: n.id, index: 0 };
    return { parentId: n.parentId, index: n.index + 1 };
  };

  return { isRootFolder, setOpen, revealFolder, openBelow, setAllOpen, canPlace, folderMove, insertionPoint };
}
