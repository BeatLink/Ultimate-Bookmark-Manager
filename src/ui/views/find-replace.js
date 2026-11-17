// Find text in bookmark names or URLs and replace it, with every change previewed before it is made.

import { h } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectionBar, selectAllToggle, bookmarkInfo, row, pagedList, pickIds, marked } from '../components.js';
import { bookmarksOnly } from '../../lib/tree.js';
import { findReplacements } from '../../lib/find-replace.js';

const LOOK_IN = { both: 'Names and URLs', title: 'Names', url: 'URLs' };

// The search as last typed, kept here so a refresh or a visit to another page does not clear it.
const search = { find: '', replace: '', field: 'both', caseSensitive: false, regex: false };

// What one bookmark's name and URL become, with the replaced text highlighted.
function becomes(b) {
  return h('div', { class: 'replaced' },
    h('div', { class: 'muted', text: 'Becomes' }),
    'title' in b.changes && h('div', { class: 'bm-title' }, b.changes.title ? marked(b.changes.title, b.after.title) : h('span', { class: 'untitled', text: '(no name)' })),
    'url' in b.changes && h('div', { class: 'bm-url' }, marked(b.changes.url, b.after.url)),
    b.problem && h('div', { class: 'warn', text: b.problem }));
}

// The selection bar and the list of bookmarks the current search would change.
function preview(ctx) {
  if (!search.find) return emptyState('Type the text to find.');
  let items;
  try {
    items = findReplacements(bookmarksOnly(ctx.state.flat), search);
  } catch (err) {
    return h('p', { class: 'error', text: `Invalid regex: ${err.message}` });
  }
  if (!items.length) return emptyState('No bookmarks would change.');

  const usable = items.filter((b) => !b.problem);
  const usableIds = usable.map((b) => b.id);
  const replace = (ids) => ctx.run(async () => {
    const changes = pickIds(usable, ids).map((b) => ({ id: b.id, ...b.changes }));
    await ctx.actions.update(changes, `Replaced “${search.find}” with “${search.replace}” in ${changes.length} bookmark(s)`);
    ctx.done(`Changed ${changes.length} bookmark(s).`);
  });
  const sel = ctx.selection('find-replace', usableIds);
  const bar = selectionBar(sel, [
    { label: 'Replace selected', primary: true, run: replace },
    { label: `Replace all (${usable.length})`, always: usable.length > 0, run: () => replace(usableIds) },
  ], [selectAllToggle(sel, usableIds)]);

  const list = h('ul', { class: 'items' });
  const more = pagedList('find-replace', list, items, (b) => {
    const content = h('div', { class: 'grow' }, bookmarkInfo(b, ctx, { editable: false, highlight: b.before }), becomes(b));
    if (!b.problem) return row(sel, b.id, content);
    return h('li', { class: 'item' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', disabled: true, 'aria-label': b.problem })), content);
  });
  bindCheckboxes(list, sel);
  const skipped = items.length - usable.length;
  const note = skipped > 0 && h('p', { class: 'warn', text: `${skipped} bookmark(s) would get a URL that is not a valid address and are left out.` });
  return h('div', {}, note, bar, list, more);
}

export default {
  id: 'find-replace',
  label: 'Find and replace',

  render(ctx) {
    const results = h('div', {}, preview(ctx));
    const redraw = () => results.replaceChildren(preview(ctx));
    const set = (key, value) => {
      search[key] = value;
      redraw();
    };
    const text = (key, label, placeholder) => h('label', { class: 'find-field' }, label,
      h('input', { type: 'text', value: search[key], placeholder, spellcheck: 'false', oninput: (e) => set(key, e.target.value) }));
    const check = (key, label, title) => h('label', { class: 'check-line', title },
      h('input', { type: 'checkbox', checked: search[key], onchange: (e) => set(key, e.target.checked) }), label);

    const form = h('div', { class: 'find-form' },
      text('find', 'Find', 'Text to find'),
      text('replace', 'Replace with', 'Leave empty to delete it'),
      h('div', { class: 'row wrap' },
        h('label', { class: 'row' }, 'Look in',
          h('select', { onchange: (e) => set('field', e.target.value) },
            Object.entries(LOOK_IN).map(([value, label]) => h('option', { value, text: label, selected: search.field === value })))),
        check('caseSensitive', 'Match case'),
        check('regex', 'Regex', 'Find with a regular expression; the replacement can use $1, $& and $<name>')));
    return h('section', {}, viewHeader('Find and replace', 'Replace text in bookmark names and URLs'), form, results);
  },
};
