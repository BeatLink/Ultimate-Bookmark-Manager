// Duplicate bookmarks grouped by URL, with bulk selection helpers and remove or move-to-folder actions.

import { h } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectionBar, bookmarkInfo, row, pagedList, ignoreAction, removeAction } from '../components.js';
import * as scans from '../scans.js';
import { allButTreeEnd, copiesInFolders, keepCopyInFolders, sameFolderExtras, foldersHoldingCopies, folderAndSubfolders } from '../../lib/duplicates.js';
import { formatPath } from '../../lib/tree.js';

// The folder chosen for folder-based selection, kept while the page redraws.
const folderChoice = { id: null, subfolders: true };

export default {
  id: 'duplicates',
  label: 'Duplicates',
  badge: (ctx) => scans.duplicates(ctx).groups.length,

  render(ctx) {
    const { groups, errors, extra } = scans.duplicates(ctx);
    const all = groups.flatMap((g) => g.items);
    const sel = ctx.selection('duplicates', all.map((b) => b.id));
    const pickIds = (ids) => { sel.clear(); sel.set(ids, true); };
    const pick = (fn) => pickIds(groups.flatMap((g) => g.items.filter((i) => fn(i, g)).map((i) => i.id)));
    const folder = ctx.state.settings.dupesFolderName;

    const header = viewHeader('Duplicates', 'Bookmarks that point to the same URL',
      h('button', { class: 'small', text: 'Matching options…', onclick: () => ctx.go('settings') }));
    header.append(h('p', { class: 'muted', text: `${groups.length} URL(s) bookmarked more than once, ${extra} extra cop${extra === 1 ? 'y' : 'ies'}.` }));
    if (errors.length) {
      header.append(h('p', { class: 'error', text: `${errors.length} custom rule(s) are invalid and were skipped — see Settings.` }));
    }
    if (!groups.length) return h('section', {}, header, emptyState('No duplicates found.'));

    // Removing every copy of a URL loses it altogether, which the confirmation points out.
    const wholeGroups = (ids) => {
      const chosen = new Set(ids);
      const gone = groups.filter((g) => g.items.every((i) => chosen.has(i.id))).length;
      return gone ? ` ${gone} group(s) would lose every copy.` : '';
    };
    const bar = selectionBar(sel, [
      { label: `Move to “${folder}”`, title: `Move to a “${folder}” folder in Other Bookmarks`, run: (ids) => ctx.run(async () => {
        await ctx.actions.moveToFolder(ids, folder);
        ctx.done(`Moved ${ids.length} bookmark(s) to “${folder}”.`);
      }) },
      ignoreAction(ctx, all),
      removeAction(ctx, {
        ask: (ids) => `Remove ${ids.length} bookmark(s)?${wholeGroups(ids)} You can undo this from the history.`,
        label: (ids) => `Removed ${ids.length} duplicate bookmark(s)`,
        done: (ids) => `Removed ${ids.length} duplicate(s).`,
      }),
    ], [
      h('button', { class: 'small', text: 'All but oldest', title: 'Select every copy except the first one added', onclick: () => pick((i) => i.order > 1) }),
      h('button', { class: 'small', text: 'All but newest', title: 'Select every copy except the last one added', onclick: () => pick((i, g) => i.order < g.items.length) }),
      h('button', { class: 'small', text: 'All but topmost', title: 'Select every copy except the one highest up in your bookmarks', onclick: () => pickIds(allButTreeEnd(groups)) }),
      h('button', { class: 'small', text: 'All but bottommost', title: 'Select every copy except the one lowest down in your bookmarks', onclick: () => pickIds(allButTreeEnd(groups, true)) }),
      h('button', { class: 'small', text: 'Same-folder extras', title: 'Select copies that share a folder with an older copy', onclick: () => pickIds(sameFolderExtras(groups)) }),
      h('button', { class: 'small', text: 'Clear', onclick: () => sel.clear() }),
    ]);
    const list = h('div', { class: 'groups' });

    const more = pagedList('duplicates', list, groups, (g) => h('section', { class: 'group' },
      h('h2', { class: 'group-title', text: g.key, title: 'Comparison key' }),
      h('ul', { class: 'items' }, g.items.map((b) => row(sel, b.id,
        h('div', { class: 'row top grow' }, h('span', { class: 'order', text: b.order, title: `Added ${b.order === 1 ? 'first' : `#${b.order}`}` }), bookmarkInfo(b, ctx)))))));
    bindCheckboxes(list, sel);
    return h('section', {}, header, bar, folderRow(ctx, groups, pickIds), list, more);
  },
};

// Picks a folder and selects the copies in it, or keeps only its copy of each URL.
function folderRow(ctx, groups, pickIds) {
  const folders = foldersHoldingCopies(groups, ctx.state.flat);
  if (!folders.some((f) => f.id === folderChoice.id)) folderChoice.id = folders[0]?.id ?? null;
  const chosen = () => (folderChoice.subfolders ? folderAndSubfolders(ctx.state.flat, folderChoice.id) : new Set([folderChoice.id]));
  return h('div', { class: 'row wrap folder-select' },
    h('label', { class: 'row' }, 'Folder',
      h('select', { onchange: (e) => { folderChoice.id = e.target.value; } },
        folders.map((f) => h('option', { value: f.id, text: formatPath(f.path), selected: f.id === folderChoice.id })))),
    h('label', { class: 'check-line' },
      h('input', { type: 'checkbox', checked: folderChoice.subfolders, onchange: (e) => { folderChoice.subfolders = e.target.checked; } }), 'with subfolders'),
    h('button', { class: 'small', text: 'Select in folder', title: 'Select every copy in this folder', onclick: () => pickIds(copiesInFolders(groups, chosen())) }),
    h('button', { class: 'small', text: 'Keep the folder’s copy', title: 'For each URL with a copy in this folder, select every other copy', onclick: () => pickIds(keepCopyInFolders(groups, chosen())) }));
}
