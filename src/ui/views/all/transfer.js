// Exporting and importing a bookmarks HTML file, and the JSON backup menu.

import { h, toast, confirmDialog, downloadFile, datedName, menuBelow } from '../../dom.js';
import { toBookmarkHtml, parseBookmarkHtml } from '../../../lib/bookmark-html.js';
import { countBookmarks } from '../../../lib/tree.js';
import { backupJson, restoreInput } from '../../backup.js';
import { IMPORT_PLACE } from './commands.js';

export function transferOf(lib) {
  const { ctx, root } = lib;

  const exportHtml = () => downloadFile(toBookmarkHtml(root.children), datedName('bookmarks', 'html'), 'text/html');
  const htmlInput = h('input', { type: 'file', accept: '.html,.htm,text/html', hidden: true, onchange: async () => {
    const file = htmlInput.files[0];
    htmlInput.value = '';
    if (!file) return;
    const snaps = parseBookmarkHtml(await file.text());
    const count = countBookmarks(snaps);
    if (!count) return toast('No bookmarks found in that file.', 'error');
    const title = `Imported ${new Date().toLocaleDateString()}`;
    if (!(await confirmDialog(`Import ${count} bookmark(s) into a new folder “${title}” in Other Bookmarks?`, 'Import', false))) return;
    await lib.create([{ type: 'folder', title, children: snaps }], `Imported ${count} bookmark(s)`, `Imported ${count} bookmark(s) into “${title}”.`, IMPORT_PLACE);
  } });
  const backupInput = restoreInput(ctx);
  const backupMenu = (e) => menuBelow(e.currentTarget, [
    { label: 'Export bookmarks to HTML…', run: exportHtml },
    { label: 'Import bookmarks from HTML…', run: () => htmlInput.click() },
    '-',
    { label: 'Back up to JSON…', run: backupJson },
    { label: 'Restore from JSON backup…', run: () => backupInput.click() },
  ]);

  return { backupMenu, fileInputs: [htmlInput, backupInput] };
}
