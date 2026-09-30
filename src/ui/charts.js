// Small chart pieces for the dashboard, built from plain elements: stat tiles, bar lists, a column chart and a card
// that switches between a chart and a table of the same numbers.

import { h } from './dom.js';

export const fmt = (n) => n.toLocaleString();
const compactFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const compact = (n) => (Math.abs(n) >= 10000 ? compactFormat.format(n) : fmt(n));

// One tooltip for the whole page; values lead and labels follow.
let tip = null;
function tooltip() {
  if (!tip || !tip.isConnected) {
    tip = h('div', { class: 'viz-tooltip', role: 'tooltip', hidden: true });
    document.body.append(tip);
  }
  return tip;
}

function showTip(value, label, x, y) {
  const t = tooltip();
  t.replaceChildren(h('strong', { text: value }), h('span', { text: label }));
  t.hidden = false;
  const pad = 12;
  const w = t.offsetWidth || 160;
  t.style.left = `${Math.min(x + pad, window.innerWidth - w - pad)}px`;
  t.style.top = `${Math.max(pad, y - (t.offsetHeight || 40) - pad)}px`;
}

function hideTip() {
  if (tip) tip.hidden = true;
}

// Gives a mark a hover and keyboard tooltip; the mark itself (plus its padding) is the hit target.
function withTip(el, value, label) {
  el.addEventListener('pointermove', (e) => showTip(value, label, e.clientX, e.clientY));
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', () => {
    const r = el.getBoundingClientRect();
    showTip(value, label, r.left + r.width / 2, r.top);
  });
  el.addEventListener('blur', hideTip);
  el.setAttribute('aria-label', `${label}: ${value}`);
  return el;
}

// A headline number: label, value and an optional note; a link when it leads somewhere.
export function statTile({ label, value, note, href, hero = false, muted = false }) {
  const shown = typeof value === 'number' ? compact(value) : value;
  return h(href ? 'a' : 'div', { class: `stat-tile${hero ? ' hero' : ''}${muted ? ' muted-tile' : ''}`, href, title: typeof value === 'number' ? fmt(value) : null },
    h('span', { class: 'stat-label', text: label }),
    h('span', { class: 'stat-value', text: shown }),
    note && h('span', { class: 'stat-note', text: note }));
}

// Horizontal bars, longest first, with the value at each tip; rows become buttons when `onSelect` is given.
export function barList(items, { total, unit = 'bookmarks', onSelect, selectHint } = {}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return h('ol', { class: 'bar-list' }, items.map((item) => {
    const share = total ? ` · ${Math.round((100 * item.count) / total)}% of all` : '';
    const tag = onSelect ? 'button' : 'div';
    const row = h(tag, { class: 'bar-row', type: onSelect ? 'button' : null, tabindex: onSelect ? null : '0', title: onSelect ? selectHint : null, onclick: onSelect ? () => onSelect(item) : null },
      h('span', { class: 'bar-label', text: item.name, title: item.name }),
      h('span', { class: 'bar-track' },
        // The longest bar leaves room at the end of the track for its value.
        h('span', { class: 'bar', style: `width: max(2px, calc((100% - 4em) * ${item.count / max}))` }),
        h('span', { class: 'bar-value', text: fmt(item.count) })));
    withTip(row, `${fmt(item.count)} ${unit}`, `${item.name}${share}`);
    return h('li', {}, row);
  }));
}

// A round number at or above `n` for the top of an axis (1, 2 or 5 times a power of ten), kept even so the
// middle gridline is a whole count.
export function niceCeil(n) {
  if (n <= 2) return 2;
  const p = 10 ** Math.floor(Math.log10(n));
  const top = [1, 2, 5, 10].map((m) => m * p).find((v) => v >= n);
  return top % 2 ? top + 1 : top;
}

// Columns over time with hairline gridlines at round values; only the busiest column carries its number.
export function columnChart(items, { labelOf, shortLabelOf, unit = 'added' }) {
  const top = niceCeil(Math.max(0, ...items.map((i) => i.count)));
  const peak = items.reduce((best, i) => (i.count > (best?.count ?? 0) ? i : best), null);
  const ticks = [top, top / 2, 0];
  return h('div', { class: 'column-chart' },
    h('div', { class: 'col-axis' }, ticks.map((t) => h('span', { text: fmt(t) }))),
    h('div', { class: 'col-plot' },
      h('div', { class: 'col-grid', 'aria-hidden': 'true' }, ticks.map(() => h('span'))),
      h('div', { class: 'cols' }, items.map((item) => {
        const col = h('span', { class: 'col', tabindex: '0' },
          item === peak && item.count > 0 ? h('span', { class: 'col-peak', text: fmt(item.count) }) : null,
          h('span', { class: 'col-bar', style: `height: ${(100 * item.count) / top}%` }));
        return withTip(col, `${fmt(item.count)} ${unit}`, labelOf(item));
      })),
      h('div', { class: 'col-labels', 'aria-hidden': 'true' }, items.map((item, i) => h('span', { text: shortLabelOf(item, i) })))));
}

// A titled card holding a chart, with a Table switch that shows the same numbers as a table.
export function chartCard({ title, subtitle, chart, columns, rows, wide = false }) {
  const table = h('table', { class: 'viz-table', hidden: true },
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { text: c, scope: 'col' })))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((cell) => h('td', { class: typeof cell === 'number' ? 'num' : null, text: typeof cell === 'number' ? fmt(cell) : cell }))))));
  const body = h('div', { class: 'viz-body' }, chart);
  const toggle = h('button', { class: 'small', type: 'button', text: 'Table', 'aria-pressed': 'false', onclick: () => {
    const showTable = table.hidden;
    table.hidden = !showTable;
    body.hidden = showTable;
    toggle.setAttribute('aria-pressed', String(showTable));
    toggle.textContent = showTable ? 'Chart' : 'Table';
  } });
  return h('section', { class: `viz-card${wide ? ' wide' : ''}` },
    h('header', { class: 'viz-head' },
      h('div', {}, h('h2', { text: title }), subtitle && h('p', { class: 'muted small', text: subtitle })),
      toggle),
    body,
    h('div', { class: 'viz-table-wrap' }, table));
}
