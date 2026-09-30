// Building blocks the views share: headers, selection toolbars, checkboxes and bookmark rows.

import { h, formatDate } from './dom.js';
import { formatPath } from '../lib/tree.js';

export function viewHeader(title, description, ...actions) {
  return h('header', { class: 'view-header' },
    h('div', {}, h('h1', { text: title }), description && h('p', { class: 'muted', text: description })),
    h('div', { class: 'row wrap' }, actions),
  );
}

export function emptyState(text) {
  return h('div', { class: 'empty-state' }, h('p', { text }));
}

export function checkbox(sel, id, label) {
  return h('input', { type: 'checkbox', 'data-sel': id, checked: sel.has(id), 'aria-label': label ?? 'Select' });
}

// Keeps every checkbox inside the container in step with the selection, using one listener for the lot.
export function bindCheckboxes(container, sel) {
  container.addEventListener('change', (e) => {
    const id = e.target.dataset?.sel;
    if (id !== undefined) sel.set([id], e.target.checked);
  });
  sel.onChange(() => {
    for (const box of container.querySelectorAll('input[data-sel]')) box.checked = sel.has(box.dataset.sel);
  });
}

// A sticky toolbar showing the selection count, with actions that stay disabled until something is selected.
export function selectionBar(sel, actions, leading = []) {
  const count = h('span', { class: 'muted count' });
  const buttons = actions.map((a) =>
    h('button', { class: a.danger ? 'danger' : a.primary ? 'primary' : '', text: a.label, title: a.title, onclick: () => a.run(sel.ids) }));
  const update = () => {
    count.textContent = `${sel.size} selected`;
    buttons.forEach((b, i) => { b.disabled = !actions[i].always && sel.size === 0; });
  };
  sel.onChange(update);
  update();
  return h('div', { class: 'selection-bar' }, h('div', { class: 'row wrap' }, leading), h('div', { class: 'row wrap end' }, count, buttons));
}

export function selectAllToggle(sel, ids, label = 'Select all') {
  return h('button', {
    class: 'small',
    text: label,
    onclick: () => sel.set(ids, !ids.every((id) => sel.has(id))),
  });
}

// Title, URL, folder path and date of one bookmark, with optional inline editing.
export function bookmarkInfo(b, ctx, { editable = true, meta = [] } = {}) {
  const box = h('div', { class: 'bm' });
  const show = () => {
    box.replaceChildren(
      h('div', { class: 'bm-title' },
        b.url ? h('a', { href: b.url, target: '_blank', rel: 'noreferrer', text: b.title || '(no name)', class: b.title ? '' : 'untitled' })
          : h('span', { text: b.title || '(no name)' }),
        editable && h('button', { class: 'link small', text: 'Edit', onclick: edit }),
      ),
      b.url && h('div', { class: 'bm-url', text: b.url, title: b.url }),
      h('div', { class: 'bm-meta muted' },
        h('span', { text: formatPath(b.path ?? []) }),
        b.dateAdded ? h('span', { text: `Added ${formatDate(b.dateAdded)}` }) : null,
        meta,
      ),
    );
  };
  const edit = () => {
    const title = h('input', { type: 'text', value: b.title ?? '', 'aria-label': 'Name', placeholder: 'Name' });
    const url = b.url !== undefined ? h('input', { type: 'url', value: b.url, 'aria-label': 'URL', placeholder: 'URL' }) : null;
    const save = async (e) => {
      e.preventDefault();
      const changes = { id: b.id };
      if (title.value !== (b.title ?? '')) changes.title = title.value;
      if (url && url.value !== b.url) changes.url = url.value;
      if (Object.keys(changes).length === 1) return show();
      await ctx.run(() => ctx.actions.update([changes], `Edited “${title.value || b.url}”`));
    };
    box.replaceChildren(h('form', { class: 'edit-form', onsubmit: save },
      title, url,
      h('div', { class: 'row' },
        h('button', { type: 'submit', class: 'primary small', text: 'Save' }),
        h('button', { type: 'button', class: 'small', text: 'Cancel', onclick: show })),
      h('p', { class: 'muted small', text: 'Esc cancels' }),
    ));
    box.addEventListener('keydown', (e) => e.key === 'Escape' && show(), { once: true });
    title.focus();
  };
  show();
  return box;
}

export function row(sel, id, content, extra = []) {
  return h('li', { class: 'item' }, h('label', { class: 'check' }, checkbox(sel, id)), content, h('div', { class: 'item-actions' }, extra));
}
