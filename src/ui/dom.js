// Small DOM helpers shared by every view.

// Builds an element: props starting with "on" become listeners, "class" and "text" are shortcuts, the rest are attributes.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function formatDate(ms) {
  return ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}

export function toast(message, kind = 'info', action) {
  const host = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message,
    action && h('button', { class: 'link', onclick: () => { el.remove(); action.run(); } }, action.label));
  host.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 10000 : 6000);
}

// Shows a modal yes/no question and resolves true when confirmed.
export function confirmDialog(message, confirmLabel = 'Continue', danger = true) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'confirm' },
      h('p', { text: message }),
      h('form', { method: 'dialog', class: 'row end' },
        h('button', { value: 'cancel', text: 'Cancel' }),
        h('button', { value: 'ok', class: danger ? 'danger' : 'primary', text: confirmLabel, autofocus: true }),
      ),
    );
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

// Asks for a line of text in a modal; resolves to the trimmed text, or null when cancelled or left blank.
export function promptDialog(message, confirmLabel = 'OK', value = '') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value, autofocus: true });
    // Cancel is a plain button, so Enter in the text box submits through the confirm button.
    const dialog = h('dialog', { class: 'confirm prompt' },
      h('form', { method: 'dialog' },
        h('label', {}, h('span', { text: message }), input),
        h('div', { class: 'row end' },
          h('button', { type: 'button', text: 'Cancel', onclick: () => dialog.close('cancel') }),
          h('button', { value: 'ok', class: 'primary', text: confirmLabel }))),
    );
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok' ? input.value.trim() || null : null);
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

// A set of selected ids that notifies listeners whenever it changes.
export class Selection {
  #ids = new Set();
  #listeners = new Set();

  has(id) { return this.#ids.has(id); }
  get size() { return this.#ids.size; }
  get ids() { return [...this.#ids]; }

  set(ids, on) {
    for (const id of ids) on ? this.#ids.add(id) : this.#ids.delete(id);
    this.#emit();
  }

  clear() {
    this.#ids.clear();
    this.#emit();
  }

  // Drops ids no longer on screen, e.g. bookmarks removed since the last render.
  retain(ids) {
    const keep = new Set(ids);
    for (const id of this.#ids) if (!keep.has(id)) this.#ids.delete(id);
  }

  // Forgets the previous render's listeners before the selection is reused by a new one.
  resetListeners() {
    this.#listeners.clear();
  }

  onChange(fn) {
    this.#listeners.add(fn);
  }

  #emit() {
    for (const fn of this.#listeners) fn(this);
  }
}

// Saves text as a file through the browser's download prompt.
export function downloadFile(text, name, type = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Asks for several lines of text in a modal; resolves to { name: trimmed text }, or null when cancelled.
// A field's `validate` returns an error message to keep the dialog open.
export function fieldsDialog(heading, fields, confirmLabel = 'Save') {
  return new Promise((resolve) => {
    const inputs = fields.map((f) => h('input', { type: 'text', value: f.value ?? '', placeholder: f.placeholder, spellcheck: f.spellcheck ?? null }));
    const error = h('p', { class: 'error small', hidden: true });
    const check = (e) => {
      if (e.submitter?.value !== 'ok') return;
      for (const [i, f] of fields.entries()) {
        const message = f.validate?.(inputs[i].value.trim());
        if (!message) continue;
        e.preventDefault();
        error.textContent = message;
        error.hidden = false;
        inputs[i].focus();
        return;
      }
    };
    const dialog = h('dialog', { class: 'confirm prompt' },
      h('form', { method: 'dialog', onsubmit: check },
        h('h2', { text: heading }),
        fields.map((f, i) => h('label', {}, h('span', { text: f.label }), inputs[i])),
        error,
        h('div', { class: 'row end' },
          h('button', { type: 'button', text: 'Cancel', onclick: () => dialog.close('cancel') }),
          h('button', { value: 'ok', class: 'primary', text: confirmLabel }))),
    );
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok' ? Object.fromEntries(fields.map((f, i) => [f.name, inputs[i].value.trim()])) : null);
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
    inputs[0]?.select();
  });
}

// A popup menu at a point on screen. Items are { label, key, disabled, run } or '-' for a divider; falsy items are skipped.
// The chosen item runs after the menu has closed and `onClose` has run.
export function showMenu(x, y, items, onClose) {
  let chosen = null;
  const dialog = h('dialog', { class: 'menu', 'aria-label': 'Menu' });
  const list = h('div', { role: 'menu' });
  const entries = items.filter(Boolean).filter((it, i, all) => it !== '-' || (i > 0 && i < all.length - 1 && all[i - 1] !== '-'));
  for (const it of entries) {
    if (it === '-') list.append(h('hr', { role: 'separator' }));
    else list.append(h('button', { type: 'button', role: 'menuitem', disabled: !!it.disabled, onclick: () => { chosen = it; dialog.close(); } },
      h('span', { text: it.label }), it.key && h('span', { class: 'menu-key', text: it.key })));
  }
  dialog.append(list);
  const buttons = () => [...list.querySelectorAll('button:not(:disabled)')];
  dialog.addEventListener('keydown', (e) => {
    const all = buttons();
    const at = all.indexOf(document.activeElement);
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
    if (next === undefined || !all.length) return;
    e.preventDefault();
    all[(next + all.length) % all.length].focus();
  });
  // A click or right-click outside the menu lands on the dialog's backdrop and closes it.
  const outside = (e) => {
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      e.preventDefault();
      dialog.close();
    }
  };
  dialog.addEventListener('mousedown', outside);
  dialog.addEventListener('contextmenu', (e) => e.preventDefault());
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
    chosen?.run();
  });
  document.body.append(dialog);
  dialog.showModal();
  const r = dialog.getBoundingClientRect();
  dialog.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  dialog.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  buttons()[0]?.focus();
}
