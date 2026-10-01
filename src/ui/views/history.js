// Undo history of every change this add-on made, plus a full backup download.

import { h, formatDate, confirmDialog } from '../dom.js';
import { viewHeader, emptyState } from '../components.js';
import { backupJson, restoreBackup } from './all.js';

function describe(op) {
  if (op.kind === 'remove') return `Removed ${op.snapshot.type} “${op.snapshot.title || op.snapshot.url || ''}”`;
  if (op.kind === 'update') return `Changed ${Object.keys(op.before).join(' and ')} (was “${Object.values(op.before).join('”, “')}”)`;
  if (op.kind === 'move') return 'Moved an item';
  if (op.kind === 'rulePaths') return `Pointed organize rules at “${op.to.join(' › ')}”`;
  return 'Created an item';
}

export default {
  id: 'history',
  label: 'History & backup',

  render(ctx) {
    const restoreInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => {
      const file = restoreInput.files[0];
      restoreInput.value = '';
      if (file) restoreBackup(ctx, file);
    } });
    const section = h('section', {}, viewHeader('History & backup', 'Undo changes made here, newest first',
      h('button', { text: 'Download full backup (JSON)', onclick: backupJson }),
      h('button', { text: 'Restore from backup…', title: 'Replace all your bookmarks with those in a JSON backup; you can undo it', onclick: () => restoreInput.click() }),
      restoreInput));
    const redoBox = h('div');
    const list = h('div', {}, h('p', { class: 'muted', text: 'Loading…' }));
    section.append(redoBox, list);

    ctx.actions.nextRedo().then((label) => {
      if (label) redoBox.replaceChildren(h('div', { class: 'row wrap redo-row' }, h('span', { class: 'muted', text: `Undone: ${label}` }), h('button', { class: 'small', text: 'Redo', onclick: () => ctx.redo() })));
    });
    ctx.actions.list().then((entries) => {
      if (!entries.length) return list.replaceChildren(emptyState('Nothing to undo yet.'));
      list.replaceChildren(
        h('ol', { class: 'items history' }, entries.map((e, i) => h('li', { class: 'item' },
          h('div', { class: 'bm grow' },
            h('div', { class: 'bm-title', text: e.label }),
            h('div', { class: 'bm-meta muted' }, h('span', { text: `${formatDate(e.time)} ${new Date(e.time).toLocaleTimeString()}` }), h('span', { text: `${e.ops.length} change(s)` })),
            h('details', {}, h('summary', { text: 'Details' }), h('ul', { class: 'ops' }, e.ops.slice(0, 200).map((op) => h('li', { text: describe(op) }))))),
          h('div', { class: 'item-actions' }, i === 0
            ? h('button', { class: 'primary small', text: 'Undo', onclick: () => ctx.undo() })
            : null)))),
        h('button', { class: 'small', text: 'Clear history', onclick: async () => {
          if (await confirmDialog('Forget all undo history? The changes themselves stay.', 'Clear')) ctx.run(() => ctx.actions.clearHistory());
        } }),
      );
    });
    return section;
  },
};
