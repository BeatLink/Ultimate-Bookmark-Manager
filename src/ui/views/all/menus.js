// The right-click menu, which the Organize button shows too.

import { showMenu } from '../../dom.js';
import { ROOT, ROOT_IDS, nodeType, isFolder } from '../../../lib/tree.js';
import { view, searching, sorted } from './state.js';

const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';

export function menusOf(lib) {
  const { get } = lib;

  const contextMenu = (x, y) => {
    const ids = lib.topSelected();
    const nodes = ids.map(get);
    const single = nodes.length === 1 ? nodes[0] : null;
    const urls = lib.urlsOf(ids);
    const folder = single && isFolder(single) ? single : null;
    const sortTarget = folder ?? get(get(view.focus)?.parentId);
    const editable = single && !ROOT_IDS.has(single.id) && nodeType(single) !== 'separator';
    const onlyRoots = nodes.length > 0 && !lib.movable(ids).length;
    showMenu(x, y, [
      urls.length > 0 && { label: urls.length > 1 ? `Open ${urls.length} in new tabs` : 'Open in new tab', key: 'Enter', run: () => lib.open(urls, 'tab') },
      urls.length > 0 && { label: 'Open in new window', run: () => lib.open(urls, 'window') },
      urls.length > 0 && { label: 'Open in new private window', run: () => lib.open(urls, 'private') },
      urls.length > 0 && { label: 'Open in new container tab…', run: () => lib.openInContainer(urls, x, y) },
      folder && { label: 'Open all in tabs', disabled: !lib.folderUrls(folder.id).length, run: () => lib.open(lib.folderUrls(folder.id), 'tab') },
      searching() && single && { label: 'Show in folder', run: () => lib.showInFolder(single.id) },
      '-',
      { label: 'New bookmark…', run: lib.newBookmark },
      { label: 'New folder…', run: lib.newFolder },
      { label: 'New separator', disabled: sorted(), run: lib.newSeparator },
      { label: 'Bookmark all tabs…', run: lib.bookmarkTabs },
      '-',
      { label: 'Undo', key: `${mod}Z`, run: lib.undo },
      { label: 'Redo', key: `${mod}Shift+Z`, run: lib.redo },
      '-',
      { label: 'Cut', key: `${mod}X`, disabled: !nodes.length || onlyRoots, run: () => lib.toClipboard('cut') },
      { label: 'Copy', key: `${mod}C`, disabled: !nodes.length, run: () => lib.toClipboard('copy') },
      { label: 'Paste', key: `${mod}V`, disabled: !view.clipboard, run: () => lib.paste() },
      '-',
      { label: 'Delete', key: 'Del', disabled: !nodes.length || onlyRoots, run: () => lib.remove(ids) },
      '-',
      sortTarget && sortTarget.id !== ROOT && { label: `Sort “${sortTarget.title || '(no name)'}” by name`, disabled: !sortTarget.children?.length, run: () => lib.sortByName(sortTarget.id) },
      { label: 'Properties…', key: 'F2', disabled: !editable, run: () => lib.properties(single.id) },
    ], () => view.focus && lib.rowEl(view.focus)?.focus({ preventScroll: true }));
  };

  return { contextMenu };
}
