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
    const input = h('input', { type: 'text', value, 'aria-label': message, autofocus: true });
    const dialog = h('dialog', { class: 'confirm' },
      h('form', { method: 'dialog' },
        h('label', { class: 'field block' }, message, input),
        h('div', { class: 'row end' },
          h('button', { value: 'cancel', text: 'Cancel', formnovalidate: true }),
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
