// The details pane under the tree: the selected item's name, URL, folder and dates, edited in place.

import { h, formatDate } from '../../dom.js';
import { ROOT_IDS, nodeType, formatPath } from '../../../lib/tree.js';
import { view } from './state.js';
import { visits, visitOf } from './visits.js';
import { urlError } from './commands.js';

export function detailsOf(lib) {
  const { get, info, details } = lib;
  // What the pane currently shows, so repainting the selection does not rebuild it and lose a half-typed edit.
  let shownFor;

  // Enter or leaving a field saves; Esc puts back what was there.
  const editForm = (n, type) => {
    const title = h('input', { type: 'text', value: n.title ?? '', 'aria-label': 'Name' });
    const url = type === 'bookmark' ? h('input', { type: 'text', value: n.url, spellcheck: 'false', 'aria-label': 'URL' }) : null;
    const error = h('p', { class: 'error small', hidden: true });
    // Enter fires both change and submit, so the same values are only saved once.
    let saved = '';
    const save = (e) => {
      e?.preventDefault();
      const values = { title: title.value.trim(), ...(url ? { url: url.value.trim() } : {}) };
      if (JSON.stringify(values) === saved) return;
      const bad = url && urlError(values.url);
      error.hidden = !bad;
      error.textContent = bad ?? '';
      if (bad) return;
      saved = JSON.stringify(values);
      lib.saveEdit(n.id, values);
    };
    const reset = (e) => {
      if (e.key !== 'Escape') return;
      title.value = n.title ?? '';
      if (url) url.value = n.url;
      error.hidden = true;
    };
    return { form: h('form', { class: 'details-form', onsubmit: save, onchange: save, onkeydown: reset },
      h('label', {}, h('span', { text: 'Name' }), title),
      url && h('label', {}, h('span', { text: 'URL' }), url),
      h('button', { type: 'submit', hidden: true, tabindex: '-1' }),
      error), error };
  };

  const drawDetails = () => {
    const ids = [...view.selected];
    const n = ids.length === 1 ? get(ids[0]) : null;
    const key = n ? `${n.id}:${visits.at}` : `none:${ids.length}`;
    if (key === shownFor) return;
    shownFor = key;
    if (!n) {
      details.replaceChildren(h('p', { class: 'muted small', text: ids.length ? `${ids.length} items selected.` : 'Select a bookmark or folder to see and edit its details.' }));
      return;
    }
    const type = nodeType(n);
    const visit = visitOf(n);
    const meta = h('p', { class: 'muted small details-meta' },
      h('span', { text: formatPath(info.get(n.id)?.path ?? []) }),
      type !== 'separator' && n.dateAdded ? h('span', { text: `Added ${formatDate(n.dateAdded)}` }) : null,
      type === 'bookmark' && visits.map ? h('span', { text: visit ? `Last visited ${formatDate(visit.last)} · ${visit.count} visit(s)` : 'Never visited' }) : null);
    if (type === 'separator' || ROOT_IDS.has(n.id)) {
      details.replaceChildren(h('p', { class: 'details-title', text: type === 'separator' ? 'Separator' : n.title }), meta);
      return;
    }
    const { form } = editForm(n, type);
    form.append(meta);
    details.replaceChildren(form);
  };

  return { drawDetails };
}
