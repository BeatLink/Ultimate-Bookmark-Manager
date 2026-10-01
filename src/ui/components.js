// Building blocks the views share: headers, selection toolbars, checkboxes and bookmark rows.

import { h, formatDate } from './dom.js';
import { formatPath, nodeType } from '../lib/tree.js';
import { byText } from '../lib/text.js';

// A small "?" with a short tip on hover that opens the matching section of the Help page; a link, so it works from the keyboard.
export function helpLink(tip, topic = location.hash.slice(1).split(':')[0] || 'stats') {
  return h('a', { class: 'help-link', href: `#help:${topic}`, title: tip ? `${tip} — select for help` : 'Help', 'aria-label': tip ? `Help: ${tip}` : 'Help', text: '?' });
}

// A page title with its help link; the longer explanation lives on the Help page.
export function viewHeader(title, tip, ...actions) {
  return h('header', { class: 'view-header' },
    h('div', { class: 'title-row' }, h('h1', { text: title }), helpLink(tip)),
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
// Text with the given [start, end] ranges wrapped in <mark>, built from text nodes so nothing is parsed as markup.
export function marked(text, ranges = []) {
  if (!ranges.length) return [text];
  const out = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) out.push(text.slice(at, start));
    out.push(h('mark', { text: text.slice(start, end) }));
    at = end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function bookmarkInfo(b, ctx, { editable = true, meta = [], highlight = null } = {}) {
  const box = h('div', { class: 'bm' });
  const show = () => {
    box.replaceChildren(
      h('div', { class: 'bm-title' },
        b.url ? h('a', { href: b.url, target: '_blank', rel: 'noreferrer', class: b.title ? '' : 'untitled' }, b.title ? marked(b.title, highlight?.title) : '(no name)')
          : h('span', { text: b.title || '(no name)' }),
        editable && h('button', { class: 'link small', text: 'Edit', onclick: edit }),
      ),
      b.url && h('div', { class: 'bm-url', title: b.url }, marked(b.url, highlight?.url)),
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
        h('button', { type: 'button', class: 'small', text: 'Cancel', title: 'Or press Esc', onclick: show })),
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

// Asks for a rule in a dialog that shows the folder tree with each folder's rules under it; resolves to the chosen
// id, or null when cancelled. `entries` are { id, label, folder, disabled, reason }, where `folder` is the rule's
// destination as a "Root/Sub/Folder" path; `extras` are choices listed above the tree, such as "all other rules".
export function pickRule(root, entries, { heading = 'Choose a rule', current = '', extras = [], confirm = 'Use this rule' } = {}) {
  return new Promise((resolve) => {
    let chosen = current;
    const ok = h('button', { value: 'ok', class: 'primary', text: confirm });
    const tree = h('ul', { class: 'folder-tree rule-tree-picker', role: 'tree' });
    const search = h('input', { type: 'search', placeholder: 'Search rules and folders', 'aria-label': 'Search rules and folders' });
    const update = () => {
      ok.disabled = !chosen;
      for (const b of tree.querySelectorAll('.rule-choice')) b.classList.toggle('selected', b.dataset.id === chosen);
    };
    const choice = (e) => h('li', {}, h('button', {
      class: 'rule-choice folder-name', type: 'button', role: 'treeitem', 'data-id': e.id, disabled: !!e.disabled, title: e.reason ?? e.label,
      onclick: () => { chosen = e.id; update(); },
      ondblclick: () => { chosen = e.id; update(); dialog.close('ok'); },
    }, h('span', { class: e.extra ? 'rank-all-icon' : 'rule-icon', 'aria-hidden': 'true' }), e.label));

    const drawTree = () => {
      const q = search.value.trim().toLowerCase();
      const shown = entries.filter((e) => !q || e.label.toLowerCase().includes(q) || e.folder.toLowerCase().includes(q));
      const byFolder = new Map();
      for (const e of shown) byFolder.set(e.folder, [...(byFolder.get(e.folder) ?? []), e]);
      const placed = new Set();
      // A folder is listed when it or a folder inside it has a rule; its rules come before its subfolders.
      const folderItem = (node, segments) => {
        const path = segments.join('/');
        const own = byFolder.get(path) ?? [];
        if (own.length) placed.add(path);
        const kids = (node.children ?? []).filter((c) => nodeType(c) === 'folder').map((c) => folderItem(c, [...segments, c.title ?? ''])).filter(Boolean);
        if (!own.length && !kids.length) return null;
        return h('li', {}, h('details', { open: true },
          h('summary', {}, h('span', { class: 'folder-label' }, h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), node.title || '(no name)')),
          h('ul', { role: 'group' }, own.map(choice), kids)));
      };
      const folders = root.children.map((c) => folderItem(c, [c.title ?? ''])).filter(Boolean);
      const elsewhere = shown.filter((e) => !placed.has(e.folder));
      tree.replaceChildren(
        ...extras.filter((e) => !q || e.label.toLowerCase().includes(q)).map((e) => choice({ ...e, extra: true })),
        ...folders,
        elsewhere.length > 0 && h('li', {}, h('details', { open: true },
          h('summary', {}, h('span', { class: 'folder-label muted', text: 'Folders that do not exist yet' })),
          h('ul', { role: 'group' }, elsewhere.map(choice)))),
      );
      if (!tree.childElementCount) tree.append(h('li', { class: 'muted', text: 'No matching rules.' }));
      update();
    };
    search.addEventListener('input', drawTree);

    const dialog = h('dialog', { class: 'folder-picker' },
      h('h2', { text: heading }),
      search,
      tree,
      h('form', { method: 'dialog', class: 'row end' }, h('button', { value: 'cancel', text: 'Cancel' }), ok));
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok' ? chosen : null);
      dialog.remove();
    });
    drawTree();
    document.body.append(dialog);
    dialog.showModal();
    search.focus();
    tree.querySelector('.selected')?.scrollIntoView?.({ block: 'center' });
  });
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
      const subfolders = (node.children ?? []).filter((c) => nodeType(c) === 'folder');
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
          if (nodeType(c) !== 'folder') continue;
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

// A ☰ button that opens a menu of actions just below it; each item is { label, title, danger, disabled, run }, and null draws a divider.
export function actionMenu(items, label = 'Actions') {
  const menu = h('div', { class: 'action-menu', popover: 'auto', role: 'menu' },
    items.map((item) => (item
      ? h('button', { type: 'button', role: 'menuitem', class: item.danger ? 'danger-text' : '', text: item.label, title: item.title, disabled: item.disabled,
        onclick: () => {
          menu.hidePopover();
          item.run();
        } })
      : h('hr', { role: 'separator' }))));
  const button = h('button', { type: 'button', class: 'small menu-button', text: '☰', title: label, 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: () => menu.togglePopover() });
  const entries = () => [...menu.querySelectorAll('button:not(:disabled)')];
  menu.addEventListener('toggle', (e) => {
    const open = e.newState === 'open';
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    // Opens below the button, right edges lined up, and stays inside the window.
    const r = button.getBoundingClientRect();
    const below = r.bottom + 4 + menu.offsetHeight <= window.innerHeight;
    menu.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - 4 - menu.offsetHeight)}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    entries()[0]?.focus();
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = entries();
    const at = list.indexOf(document.activeElement);
    list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  });
  return h('span', { class: 'menu-wrap' }, button, menu);
}
