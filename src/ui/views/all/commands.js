// The actions on bookmarks: open, create, edit, remove, sort, move, copy, cut and paste.

import { toast, confirmDialog, promptDialog, fieldsDialog, showMenu } from '../../dom.js';
import { ROOT_IDS, OTHER, nodeType, isFolder, isBookmark, pathTo } from '../../../lib/tree.js';
import { snapshot } from '../../../lib/actions.js';
import { isValidUrl, urlsInText, bookmarkableTabs } from '../../../lib/links.js';
import { nextAfterRemoval } from '../../../lib/library.js';
import { addToWhitelist, removeFromWhitelist } from '../../../lib/settings.js';
import { askPermission } from '../../permissions.js';
import { view, setSearch, searching } from './state.js';

// Firefox asks before opening more tabs than this at once.
const MANY_TABS = 15;

// The message a dialog shows for a URL that is not one, or null when it is fine.
export const urlError = (text) => (isValidUrl(text) ? null : 'Enter a full URL, such as https://example.com/.');

export function commandsOf(lib) {
  const { ctx, byId, get } = lib;

  // ---- Opening bookmarks ----

  // Opens URLs in a new tab, the current tab, a new window or a private window; a cookie store id opens them in that container.
  const open = async (urls, where, cookieStoreId) => {
    if (!urls.length) return;
    if (urls.length > MANY_TABS && !(await confirmDialog(`Open ${urls.length} tabs?`, 'Open them', false))) return;
    try {
      if (where === 'window' || where === 'private') await browser.windows.create({ url: urls, incognito: where === 'private' });
      else if (where === 'current') await browser.tabs.update({ url: urls[0] });
      else for (const [i, url] of urls.entries()) await browser.tabs.create({ url, active: i === 0 && urls.length === 1, ...(cookieStoreId ? { cookieStoreId } : {}) });
    } catch (err) {
      const why = where === 'private' ? 'Firefox may need this add-on allowed in private windows (Add-ons › Ultimate Bookmark Manager › Run in Private Windows).' : 'Firefox does not let add-ons open some addresses, such as about: pages, file: and javascript: links.';
      toast(`Could not open: ${err.message ?? err}. ${why}`, 'error');
    }
  };
  const openInContainer = async (urls, x, y) => {
    let containers = [];
    try {
      containers = await browser.contextualIdentities.query({});
    } catch { /* containers are turned off */ }
    if (!containers?.length) return toast('Turn on container tabs in Firefox’s settings (General › Tabs) to open bookmarks in them.', 'error');
    showMenu(x, y, containers.map((c) => ({ label: c.name, run: () => open(urls, 'tab', c.cookieStoreId) })));
  };
  const urlsOf = (ids) => ids.map(get).filter(isBookmark).map((n) => n.url);
  // A folder opens the bookmarks directly inside it, as Firefox's "Open All in Tabs" does.
  const folderUrls = (id) => (get(id).children ?? []).filter(isBookmark).map((n) => n.url);
  const activate = (id, where = ctx.isSidebar ? 'current' : 'tab') => {
    const n = get(id);
    if (isFolder(n) && !searching()) lib.setOpen(id, !view.expanded.has(id));
    else if (isBookmark(n)) open([n.url], where);
  };

  // ---- Creating ----

  // Selects new or moved items once the page re-renders, with their folder open.
  const afterCreate = (ids, parentId) => {
    if (!ids?.length) return;
    lib.revealFolder(parentId);
    view.selected = new Set(ids);
    view.anchor = ids[0];
    view.focus = ids[0];
    view.active = true;
  };
  const create = (snaps, label, message, place = lib.insertionPoint()) => ctx.run(async () => {
    if (searching() && snaps.length) setSearch('');
    afterCreate(await ctx.actions.create(place.parentId, place.index, snaps, label), place.parentId);
    ctx.done(message);
  });
  const newBookmark = async () => {
    const values = await fieldsDialog('New bookmark', [
      { name: 'url', label: 'URL', placeholder: 'https://', spellcheck: 'false', validate: urlError },
      { name: 'title', label: 'Name', placeholder: 'Leave blank to use the URL' },
    ], 'Add');
    if (!values) return;
    await create([{ type: 'bookmark', title: values.title, url: values.url }], `Added “${values.title || values.url}”`, `Added “${values.title || values.url}”.`);
  };
  const newFolder = async () => {
    const title = await promptDialog('Name of the new folder', 'Create folder', 'New Folder');
    if (title) await create([{ type: 'folder', title }], `Created folder “${title}”`, `Created “${title}”.`);
  };
  const newSeparator = () => create([{ type: 'separator', title: '' }], 'Added a separator', 'Added a separator.');
  // Saves the tabs of this window, without repeats or blank pages, into a new folder.
  const bookmarkTabs = async () => {
    if (!(await askPermission('tabs'))) return toast('Bookmarking tabs needs permission to read their addresses.', 'error');
    const tabs = bookmarkableTabs(await browser.tabs.query({ currentWindow: true }), browser.runtime.getURL(''));
    if (!tabs.length) return toast('There are no tabs to bookmark in this window.');
    const title = await promptDialog(`Bookmark ${tabs.length} tab(s) in a new folder named`, 'Bookmark tabs', `Tabs ${new Date().toLocaleDateString()}`);
    if (!title) return;
    await create([{ type: 'folder', title, children: tabs.map((t) => ({ type: 'bookmark', title: t.title || t.url, url: t.url })) }],
      `Bookmarked ${tabs.length} tab(s)`, `Bookmarked ${tabs.length} tab(s) in “${title}”.`);
  };

  // ---- Editing ----
  const properties = async (id) => {
    const n = get(id);
    if (!n || ROOT_IDS.has(id) || nodeType(n) === 'separator') return;
    const folder = isFolder(n);
    const values = await fieldsDialog(folder ? 'Folder properties' : 'Bookmark properties', [
      { name: 'title', label: 'Name', value: n.title ?? '' },
      !folder && { name: 'url', label: 'URL', value: n.url, spellcheck: 'false', validate: urlError },
    ].filter(Boolean));
    if (values) await saveEdit(id, values);
  };
  // Saves a new name or URL; a renamed folder takes the organize rules that name it along.
  const saveEdit = async (id, values) => {
    const n = get(id);
    const folder = isFolder(n);
    const changes = {};
    if (values.title !== (n.title ?? '')) changes.title = values.title;
    if (!folder && values.url !== undefined && values.url !== n.url) changes.url = values.url;
    if (!Object.keys(changes).length) return;
    const from = pathTo(byId, id);
    const paths = folder && changes.title !== undefined ? { from, to: [...from.slice(0, -1), changes.title] } : null;
    view.active = true;
    await ctx.run(async () => {
      await ctx.actions.edit(id, changes, paths, `Edited “${values.title || values.url || n.title}”`);
      ctx.done(`Saved “${values.title || values.url || n.title}”.`);
    });
  };
  const remove = async (ids) => {
    const targets = lib.movable(ids);
    if (!targets.length) return;
    const held = targets.map(get).filter(isFolder).reduce((sum, f) => sum + (f.children?.length ?? 0), 0);
    if (held && !(await confirmDialog(`Remove ${targets.length} item(s), including the folder contents (${held} item(s) directly inside)?`, 'Remove'))) return;
    // The focus moves to the row after the last removed one, as in the Library.
    const next = nextAfterRemoval(lib.rows.map((r) => r.node.id), new Set(targets), lib.within);
    view.active = true;
    await ctx.run(async () => {
      await ctx.actions.remove(targets, `Removed ${targets.length} item(s)`);
      lib.selectOnly(next);
      view.focus = next;
      ctx.done(`Removed ${targets.length} item(s).`);
    });
  };
  const sortByName = async (folderId) => {
    const f = get(folderId);
    if (!f || !isFolder(f) || !f.children?.length) return;
    view.active = true;
    await ctx.run(async () => {
      await ctx.actions.sortFolder(folderId, `Sorted “${f.title}” by name`);
      ctx.done(`Sorted “${f.title}” by name.`);
    });
  };
  // Ignores a folder with everything inside it in every check, or stops ignoring it.
  const toggleIgnoredFolder = (folder) => ctx.run(async () => {
    if (ctx.state.whitelist[folder.id]?.inside) {
      await removeFromWhitelist([folder.id]);
      toast(`Checks include “${folder.title || '(no name)'}” again.`, 'success');
    } else {
      await addToWhitelist([{ id: folder.id, title: folder.title, inside: true }]);
      toast(`Every check now skips “${folder.title || '(no name)'}” and everything inside it.`, 'success');
    }
  });
  const undo = () => {
    view.active = true;
    ctx.undo();
  };
  const redo = () => {
    view.active = true;
    ctx.redo();
  };

  // ---- Moving and copying ----
  const moveTo = async (ids, place) => {
    ids = lib.movable(ids);
    if (!ids.length) return;
    if (!lib.canPlace(ids, place.parentId)) return toast('A folder cannot go inside itself.', 'error');
    view.active = true;
    const dest = get(place.parentId)?.title || 'the folder';
    await ctx.run(async () => {
      await ctx.actions.moveItems(ids.map((id) => lib.folderMove(id, place.parentId)), place.parentId, place.index, `Moved ${ids.length} item(s) to “${dest}”`);
      afterCreate(ids, place.parentId);
      ctx.done(`Moved ${ids.length} item(s) to “${dest}”.`);
    });
  };
  const copyTo = (ids, place) => create(ids.map((id) => snapshot(get(id))), `Copied ${ids.length} item(s)`, `Copied ${ids.length} item(s).`, place);

  // The clipboard keeps copies of what was copied, so pasting still works after the originals change; the URLs also go to the system clipboard.
  const toClipboard = (mode) => {
    const ids = mode === 'cut' ? lib.movable(lib.topSelected()) : lib.topSelected();
    if (!ids.length) return;
    view.clipboard = { mode, ids, snaps: ids.map((id) => snapshot(get(id))), text: urlsOf(ids).join('\n') };
    if (view.clipboard.text) navigator.clipboard?.writeText(view.clipboard.text).catch(() => {});
    lib.paint();
  };
  const paste = async (place = lib.insertionPoint()) => {
    const clip = view.clipboard;
    if (!clip) return;
    if (clip.mode === 'cut') {
      view.clipboard = null;
      await moveTo(clip.ids, place);
    } else {
      await create(structuredClone(clip.snaps), `Pasted ${clip.snaps.length} item(s)`, `Pasted ${clip.snaps.length} item(s).`, place);
    }
  };
  // Text pasted from elsewhere becomes one bookmark per URL in it; false when it held none.
  const pasteText = (text) => {
    const urls = urlsInText(text);
    if (!urls.length) return false;
    create(urls.map((url) => ({ type: 'bookmark', title: url, url })), `Pasted ${urls.length} link(s)`, `Added ${urls.length} bookmark(s).`);
    return true;
  };

  // Leaves the search and shows the item in its folder.
  const showInFolder = (id) => {
    setSearch('');
    lib.search.value = '';
    lib.filter.value = 'all';
    lib.revealFolder(get(id).parentId);
    lib.selectOnly(id);
    lib.draw();
    lib.focusRow(id);
  };

  return {
    open, openInContainer, urlsOf, folderUrls, activate,
    create, newBookmark, newFolder, newSeparator, bookmarkTabs,
    properties, saveEdit, remove, sortByName, toggleIgnoredFolder, undo, redo,
    moveTo, copyTo, toClipboard, paste, pasteText, showInFolder,
  };
}

// Where an import lands: at the end of Other Bookmarks.
export const IMPORT_PLACE = { parentId: OTHER, index: null };
