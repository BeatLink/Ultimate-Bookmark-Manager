// Saving every bookmark to a JSON backup and putting one back, shared by the History and All bookmarks pages.

import { h, toast, confirmDialog, downloadFile, datedName } from './dom.js';
import { exportTree, parseBackup } from '../lib/backup.js';

// Saves every bookmark as a JSON backup this add-on can restore.
export async function backupJson() {
  downloadFile(JSON.stringify(await exportTree(), null, 2), datedName('bookmarks-backup', 'json'));
  toast('Backup downloaded.', 'success');
}

// Replaces every bookmark with those in a JSON backup, after asking; the restore is one step that can be undone.
async function restoreBackup(ctx, file) {
  let parsed;
  try {
    parsed = parseBackup(await file.text());
  } catch (err) {
    return toast(err.message, 'error');
  }
  const left = parsed.skipped ? ` ${parsed.skipped} saved search(es) will be left out, as Firefox does not let add-ons create them.` : '';
  if (!(await confirmDialog(`Replace all your bookmarks with the ${parsed.bookmarks} in this backup?${left} You can undo this.`, 'Restore'))) return;
  await ctx.run(async () => {
    await ctx.actions.restore(parsed.folders, `Restored ${parsed.bookmarks} bookmark(s) from a backup`);
    ctx.done(`Restored ${parsed.bookmarks} bookmark(s) from the backup.`);
  });
}

// A hidden file input that restores the backup chosen in it.
export function restoreInput(ctx) {
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => {
    const file = input.files[0];
    input.value = '';
    if (file) restoreBackup(ctx, file);
  } });
  return input;
}
