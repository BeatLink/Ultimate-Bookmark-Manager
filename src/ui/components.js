// Building blocks the views share: headers, selection toolbars, checkboxes and bookmark rows.

import { h, formatDate } from './dom.js';
import { formatPath } from '../lib/tree.js';
import { byText } from '../lib/text.js';

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

// A box of removable keyword chips, shown alphabetically; Enter (or a comma, when allowed) turns the typed text into a chip.
export function tagInput({ values, onchange, placeholder = 'Type and press Enter', commaSeparates = true, mono = false, label = 'Keywords' }) {
  const box = h('div', { class: `tag-input${mono ? ' mono' : ''}` });
  const input = h('input', { type: 'text', 'aria-label': label });
  const emit = () => onchange([...values]);

  const add = (raw) => {
    const parts = (commaSeparates ? raw.split(/[,\n]/) : raw.split('\n')).map((p) => p.trim()).filter(Boolean);
    let added = false;
    for (const p of parts) {
      if (!values.includes(p)) {
        values.push(p);
        added = true;
      }
    }
    input.value = '';
    if (added) {
      values.sort(byText);
      draw();
      emit();
    }
  };
  const remove = (v) => {
    values.splice(values.indexOf(v), 1);
    draw();
    emit();
  };
  // Sorted for display only, so older unsorted lists do not count as an unsaved change.
  const sorted = () => [...values].sort(byText);
  const draw = () => {
    box.replaceChildren(...sorted().map((v) => h('span', { class: 'tag' },
      h('button', { class: 'tag-text', text: v, title: 'Edit', onclick: () => { remove(v); input.value = v; input.focus(); } }),
      h('button', { class: 'tag-remove', text: '×', 'aria-label': `Remove “${v}”`, onclick: () => { remove(v); input.focus(); } }))), input);
    input.placeholder = values.length ? '' : placeholder;
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || (commaSeparates && e.key === ',')) {
      e.preventDefault();
      add(input.value);
    } else if (e.key === 'Backspace' && !input.value && values.length) {
      remove(sorted().at(-1));
    }
  });
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') ?? '';
    if (/[\n]/.test(text) || (commaSeparates && text.includes(','))) {
      e.preventDefault();
      add(input.value + text);
    }
  });
  input.addEventListener('blur', () => input.value.trim() && add(input.value));
  box.addEventListener('click', (e) => e.target === box && input.focus());
  draw();
  return box;
}

// Joins a folder's path into the "Root/Sub/Folder" form rules store; null when a name contains "/" and cannot be written that way.
function folderPath(segments) {
  return segments.some((s) => s.includes('/')) ? null : segments.join('/');
}

// Opens the bookmark folder tree in a dialog and resolves with the chosen path, or null when cancelled; `allowCreate` offers a new subfolder.
export function pickFolder(root, current = '', { heading = 'Choose a folder', verb = 'Move to', allowCreate = true } = {}) {
  return new Promise((resolve) => {
    let chosen = current;
    const preview = h('p', { class: 'picked' });
    const newName = h('input', { type: 'text', placeholder: 'New subfolder name', 'aria-label': 'New subfolder name' });
    const ok = h('button', { value: 'ok', class: 'primary', text: 'Use this folder' });
    const tree = h('ul', { class: 'folder-tree', role: 'tree' });
    const search = h('input', { type: 'search', placeholder: 'Search folders', 'aria-label': 'Search folders' });

    const target = () => {
      const extra = newName.value.trim().replaceAll('/', '');
      return chosen && extra ? `${chosen}/${extra}` : chosen;
    };
    const update = () => {
      const t = target();
      const exists = !newName.value.trim();
      preview.textContent = t ? `${exists ? verb : `Create and ${verb.toLowerCase()}`}: ${t.replaceAll('/', ' › ')}` : 'Pick a folder.';
      ok.disabled = !t;
      for (const b of tree.querySelectorAll('.folder-name')) b.classList.toggle('selected', b.dataset.path === chosen);
    };

    const folderItem = (node, segments) => {
      const path = folderPath(segments);
      const subfolders = (node.children ?? []).filter((c) => !c.url && c.children);
      const name = h('button', {
        class: 'folder-name', type: 'button', role: 'treeitem', 'data-path': path ?? '', disabled: path === null,
        title: path === null ? 'Folders with “/” in their name cannot be used as a target' : path.replaceAll('/', ' › '),
        onclick: () => { chosen = path; update(); },
        ondblclick: () => { chosen = path; update(); dialog.close('ok'); },
      }, h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), node.title || '(no name)');
      if (!subfolders.length) return h('li', {}, name);
      const open = segments.length === 1 || (current && current.startsWith(`${path}/`));
      return h('li', {}, h('details', { open },
        h('summary', {}, name),
        h('ul', { role: 'group' }, subfolders.map((c) => folderItem(c, [...segments, c.title ?? ''])))));
    };
    const drawTree = () => {
      const q = search.value.trim().toLowerCase();
      if (!q) return tree.replaceChildren(...root.children.map((c) => folderItem(c, [c.title])));
      // Searching shows matching folders as a flat list of full paths.
      const hits = [];
      const walk = (node, segments) => {
        for (const c of node.children ?? []) {
          if (c.url || !c.children) continue;
          const segs = [...segments, c.title ?? ''];
          const path = folderPath(segs);
          if (path && (c.title ?? '').toLowerCase().includes(q)) hits.push(path);
          walk(c, segs);
        }
      };
      walk(root, []);
      tree.replaceChildren(...(hits.length ? hits.slice(0, 200).map((p) => h('li', {},
        h('button', { class: 'folder-name', type: 'button', 'data-path': p, onclick: () => { chosen = p; update(); }, ondblclick: () => { chosen = p; update(); dialog.close('ok'); } },
          h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), p.replaceAll('/', ' › ')))) : [h('li', { class: 'muted', text: 'No matching folders.' })]));
      update();
    };
    search.addEventListener('input', drawTree);
    newName.addEventListener('input', update);

    const dialog = h('dialog', { class: 'folder-picker' },
      h('h2', { text: heading }),
      search,
      tree,
      allowCreate && h('div', { class: 'row' }, h('label', { class: 'grow row' }, 'Inside the selected folder, create:', newName)),
      preview,
      h('form', { method: 'dialog', class: 'row end' }, h('button', { value: 'cancel', text: 'Cancel' }), ok));
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok' ? target() : null);
      dialog.remove();
    });
    drawTree();
    update();
    document.body.append(dialog);
    dialog.showModal();
    tree.querySelector('.selected')?.scrollIntoView?.({ block: 'center' });
  });
}
