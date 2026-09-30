// Undo history of every change this add-on made, plus a full backup download.

import { h, formatDate, toast, confirmDialog } from '../dom.js';
import { viewHeader, emptyState } from '../components.js';
import { exportTree } from '../../lib/actions.js';

function describe(op) {
  if (op.kind === 'remove') return `Removed ${op.snapshot.type} “${op.snapshot.title || op.snapshot.url || ''}”`;
  if (op.kind === 'update') return `Changed ${Object.keys(op.before).join(' and ')} (was “${Object.values(op.before).join('”, “')}”)`;
  if (op.kind === 'move') return 'Moved an item';
  return 'Created a folder';
}

async function download() {
  const data = await exportTree();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `bookmarks-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Backup downloaded.', 'success');
}

export default {
  id: 'history',
  label: 'History & backup',

  render(ctx) {
    const section = h('section', {}, viewHeader('History & backup',
      'Every change made here is recorded before it happens, so it can be undone. Undo works newest first.',
      h('button', { text: 'Download full backup (JSON)', onclick: download })));
    const list = h('div', {}, h('p', { class: 'muted', text: 'Loading…' }));
    section.append(list);

    ctx.actions.list().then((entries) => {
      if (!entries.length) return list.replaceChildren(emptyState('Nothing to undo yet.'));
      list.replaceChildren(
        h('ol', { class: 'items history' }, entries.map((e, i) => h('li', { class: 'item' },
          h('div', { class: 'bm grow' },
            h('div', { class: 'bm-title', text: e.label }),
            h('div', { class: 'bm-meta muted' }, h('span', { text: `${formatDate(e.time)} ${new Date(e.time).toLocaleTimeString()}` }), h('span', { text: `${e.ops.length} change(s)` })),
            h('details', {}, h('summary', { text: 'Details' }), h('ul', { class: 'ops' }, e.ops.slice(0, 200).map((op) => h('li', { text: describe(op) }))))),
          h('div', { class: 'item-actions' }, i === 0
            ? h('button', { class: 'primary small', text: 'Undo', onclick: () => ctx.run(async () => {
              const entry = await ctx.actions.undoLatest();
              if (entry) toast(`Undone: ${entry.label}`, 'success');
            }) })
            : null)))),
        h('button', { class: 'small', text: 'Clear history', onclick: async () => {
          if (await confirmDialog('Forget all undo history? The changes themselves stay.', 'Clear')) ctx.run(() => ctx.actions.clearHistory());
        } }),
      );
    });
    return section;
  },
};
