// Building blocks the views share: headers, selection toolbars, checkboxes, bookmark rows, pickers and menus.

import { h, formatDate, openDialog, menuBelow, confirmDialog } from './dom.js';
import { formatPath, isFolder } from '../lib/tree.js';
import { groupBy } from '../lib/group.js';
import { folderLabel } from '../lib/rules.js';
import { addToWhitelist } from '../lib/settings.js';

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

// The "Ignore" action of a selection bar: the selected items join the whitelist that every check skips.
export function ignoreAction(ctx, items) {
  return { label: 'Ignore', title: 'Skip these in every check', run: (ids) => ctx.run(() => addToWhitelist(pickIds(items, ids))) };
}

// The "Remove selected" action of a selection bar: `ask` is the question, `label` the history entry and `done` the toast, each from the ids.
export function removeAction(ctx, { ask, label, done }) {
  return { label: 'Remove selected', danger: true, run: async (ids) => {
    if (!(await confirmDialog(ask(ids), 'Remove'))) return;
    await ctx.run(async () => {
      await ctx.actions.remove(ids, label(ids));
      ctx.done(done(ids));
    });
  } };
}

// How many rows each long list shows at first and adds with each "Show more".
export const PAGE = 200;
// How far each list has been opened, so a refresh does not fold it back up.
const shownBy = new Map();

// Fills `container` with the first rows of `items` made by `make`, and returns a button that adds the next page.
export function pagedList(key, container, items, make) {
  let shown = Math.min(items.length, Math.max(PAGE, shownBy.get(key) ?? 0));
  container.append(...items.slice(0, shown).map(make));
  const more = h('button', { class: 'small show-more', type: 'button' });
  const update = () => {
    more.hidden = shown >= items.length;
    more.textContent = `Show ${Math.min(PAGE, items.length - shown)} more (${items.length - shown} not shown)`;
  };
  more.addEventListener('click', () => {
    const next = items.slice(shown, shown + PAGE);
    shown += next.length;
    shownBy.set(key, shown);
    container.append(...next.map(make));
    update();
  });
  update();
  return more;
}

// The items whose id is among `ids`, looked up in a set so large selections stay quick.
export function pickIds(items, ids) {
  const wanted = new Set(ids);
  return items.filter((item) => wanted.has(item.id));
}

export function selectAllToggle(sel, ids, label = 'Select all') {
  return h('button', {
    class: 'small',
    text: label,
    onclick: () => sel.set(ids, !ids.every((id) => sel.has(id))),
  });
}

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

// Title, URL, folder path and date of one bookmark, with optional inline editing.
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

// A button in a picker's tree: a click chooses it and a double-click chooses it and confirms the dialog.
function choiceButton(props, choose, dialog, ...children) {
  return h('button', {
    type: 'button', ...props,
    onclick: () => choose(),
    ondblclick: () => { choose(); dialog.close('ok'); },
  }, ...children);
}

const dialogButtons = (ok) => h('form', { method: 'dialog', class: 'row end' }, h('button', { value: 'cancel', text: 'Cancel' }), ok);

// Asks for a rule in a dialog showing the folder tree with each rule under its destination folder and `extras` above it; resolves to the chosen id or null.
export function pickRule(root, entries, { heading = 'Choose a rule', current = '', extras = [], confirm = 'Use this rule' } = {}) {
  let chosen = current;
  const ok = h('button', { value: 'ok', class: 'primary', text: confirm });
  const tree = h('ul', { class: 'folder-tree rule-tree-picker', role: 'tree' });
  const search = h('input', { type: 'search', placeholder: 'Search rules and folders', 'aria-label': 'Search rules and folders' });
  const dialog = h('dialog', { class: 'folder-picker' }, h('h2', { text: heading }), search, tree, dialogButtons(ok));
  const update = () => {
    ok.disabled = !chosen;
    for (const b of tree.querySelectorAll('.rule-choice')) b.classList.toggle('selected', b.dataset.id === chosen);
  };
  const choice = (e) => h('li', {}, choiceButton(
    { class: 'rule-choice folder-name', role: 'treeitem', 'data-id': e.id, disabled: !!e.disabled, title: e.reason ?? e.label },
    () => { chosen = e.id; update(); }, dialog,
    h('span', { class: e.extra ? 'rank-all-icon' : 'rule-icon', 'aria-hidden': 'true' }), e.label));

  const drawTree = () => {
    const q = search.value.trim().toLowerCase();
    const shown = entries.filter((e) => !q || e.label.toLowerCase().includes(q) || e.folder.toLowerCase().includes(q));
    const byFolder = groupBy(shown, (e) => e.folder);
    const placed = new Set();
    // A folder is listed when it or a folder inside it has a rule; its rules come before its subfolders.
    const folderItem = (node, segments) => {
      const path = segments.join('/');
      const own = byFolder.get(path) ?? [];
      if (own.length) placed.add(path);
      const kids = (node.children ?? []).filter(isFolder).map((c) => folderItem(c, [...segments, c.title ?? ''])).filter(Boolean);
      if (!own.length && !kids.length) return null;
      return h('li', {}, h('details', { open: true },
        h('summary', {}, h('span', { class: 'folder-label' }, h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), node.title || '(no name)')),
        h('ul', { role: 'group' }, own.map(choice), kids)));
    };
    const folders = root.children.map((c) => folderItem(c, [c.title ?? ''])).filter(Boolean);
    const elsewhere = shown.filter((e) => !placed.has(e.folder));
    const missing = elsewhere.length > 0 && h('li', {}, h('details', { open: true },
      h('summary', {}, h('span', { class: 'folder-label muted', text: 'Folders that do not exist yet' })),
      h('ul', { role: 'group' }, elsewhere.map(choice))));
    tree.replaceChildren(
      ...extras.filter((e) => !q || e.label.toLowerCase().includes(q)).map((e) => choice({ ...e, extra: true })),
      ...folders,
      ...(missing ? [missing] : []),
    );
    if (!tree.childElementCount) tree.append(h('li', { class: 'muted', text: 'No matching rules.' }));
    update();
  };
  search.addEventListener('input', drawTree);
  drawTree();
  const done = openDialog(dialog, (result) => (result === 'ok' ? chosen : null));
  search.focus();
  tree.querySelector('.selected')?.scrollIntoView?.({ block: 'center' });
  return done;
}

// Joins a folder's path into the "Root/Sub/Folder" form rules store; null when a name contains "/" and cannot be written that way.
function folderPath(segments) {
  return segments.some((s) => s.includes('/')) ? null : segments.join('/');
}

// Opens the bookmark folder tree in a dialog and resolves with the chosen path, or null when cancelled; `allowCreate` offers a new subfolder.
export function pickFolder(root, current = '', { heading = 'Choose a folder', verb = 'Move to', allowCreate = true } = {}) {
  let chosen = current;
  const preview = h('p', { class: 'picked' });
  const newName = h('input', { type: 'text', placeholder: 'New subfolder name', 'aria-label': 'New subfolder name' });
  const ok = h('button', { value: 'ok', class: 'primary', text: 'Use this folder' });
  const tree = h('ul', { class: 'folder-tree', role: 'tree' });
  const search = h('input', { type: 'search', placeholder: 'Search folders', 'aria-label': 'Search folders' });
  const dialog = h('dialog', { class: 'folder-picker' },
    h('h2', { text: heading }),
    search,
    tree,
    allowCreate && h('div', { class: 'row' }, h('label', { class: 'grow row' }, 'Inside the selected folder, create:', newName)),
    preview,
    dialogButtons(ok));

  const target = () => {
    const extra = newName.value.trim().replaceAll('/', '');
    return chosen && extra ? `${chosen}/${extra}` : chosen;
  };
  const update = () => {
    const t = target();
    const exists = !newName.value.trim();
    preview.textContent = t ? `${exists ? verb : `Create and ${verb.toLowerCase()}`}: ${folderLabel(t)}` : 'Pick a folder.';
    ok.disabled = !t;
    for (const b of tree.querySelectorAll('.folder-name')) b.classList.toggle('selected', b.dataset.path === chosen);
  };
  const folderButton = (path, props, ...children) => choiceButton(
    { class: 'folder-name', 'data-path': path ?? '', ...props }, () => { chosen = path; update(); }, dialog,
    h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), ...children);

  const folderItem = (node, segments) => {
    const path = folderPath(segments);
    const subfolders = (node.children ?? []).filter(isFolder);
    const name = folderButton(path, {
      role: 'treeitem', disabled: path === null,
      title: path === null ? 'Folders with “/” in their name cannot be used as a target' : folderLabel(path),
    }, node.title || '(no name)');
    if (!subfolders.length) return h('li', {}, name);
    const open = segments.length === 1 || Boolean(current?.startsWith(`${path}/`));
    return h('li', {}, h('details', { open },
      h('summary', {}, name),
      h('ul', { role: 'group' }, subfolders.map((c) => folderItem(c, [...segments, c.title ?? ''])))));
  };
  const drawTree = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) return tree.replaceChildren(...root.children.map((c) => folderItem(c, [c.title ?? ''])));
    // Searching shows matching folders as a flat list of full paths.
    const hits = [];
    const walk = (node, segments) => {
      for (const c of node.children ?? []) {
        if (!isFolder(c)) continue;
        const segs = [...segments, c.title ?? ''];
        const path = folderPath(segs);
        if (path && (c.title ?? '').toLowerCase().includes(q)) hits.push(path);
        walk(c, segs);
      }
    };
    walk(root, []);
    tree.replaceChildren(...(hits.length ? hits.slice(0, PAGE).map((p) => h('li', {}, folderButton(p, {}, folderLabel(p)))) : [h('li', { class: 'muted', text: 'No matching folders.' })]));
    update();
  };
  search.addEventListener('input', drawTree);
  newName.addEventListener('input', update);
  drawTree();
  update();
  const done = openDialog(dialog, (result) => (result === 'ok' ? target() : null));
  tree.querySelector('.selected')?.scrollIntoView?.({ block: 'center' });
  return done;
}

// A ☰ button that opens a menu of actions just below it; the items are those of `showMenu`.
export function actionMenu(items, label = 'Actions') {
  const button = h('button', { type: 'button', class: 'small menu-button', text: '☰', title: label, 'aria-label': label, 'aria-haspopup': 'menu' });
  button.addEventListener('click', () => menuBelow(button, items));
  return button;
}
