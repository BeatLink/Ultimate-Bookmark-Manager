import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, uninstallDom } from './browser-env.js';

installBrowser();
const { fmt, statTile, barList, niceCeil, columnChart, chartCard } = await import('../src/ui/charts.js');

after(uninstallDom);

const tooltip = () => document.querySelector('.viz-tooltip');

test('a stat tile shows its label, value and note, and becomes a link when it leads somewhere', () => {
  const tile = statTile({ label: 'Bookmarks', value: 1234, note: 'in 5 folders', tip: 'Everything', href: '#all', hero: true, muted: true });
  assert.equal(tile.tagName, 'A');
  assert.equal(tile.getAttribute('href'), '#all');
  assert.equal(tile.className, 'stat-tile hero muted-tile');
  assert.equal(tile.querySelector('.stat-label').textContent, 'Bookmarks');
  assert.equal(tile.querySelector('.stat-value').textContent, fmt(1234));
  assert.equal(tile.querySelector('.stat-note').textContent, 'in 5 folders');
  assert.equal(tile.title, 'Everything');
});

test('a stat tile shortens big numbers and gives the exact one in its tooltip', () => {
  const tile = statTile({ label: 'Visits', value: 123456 });
  assert.equal(tile.tagName, 'DIV');
  assert.equal(tile.className, 'stat-tile');
  assert.notEqual(tile.querySelector('.stat-value').textContent, fmt(123456));
  assert.equal(tile.title, fmt(123456));
  assert.equal(tile.querySelector('.stat-note'), null);
});

test('a stat tile shows text values as they are, with no tooltip', () => {
  const tile = statTile({ label: 'Last check', value: 'Never' });
  assert.equal(tile.querySelector('.stat-value').textContent, 'Never');
  assert.equal(tile.hasAttribute('title'), false);
});

test('a bar list scales bars to the longest one and labels each with its share', () => {
  const list = barList([{ name: 'a.test', count: 30 }, { name: 'b.test', count: 15 }], { total: 60, unit: 'links' });
  const rows = list.querySelectorAll('.bar-row');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tagName, 'DIV');
  assert.equal(rows[0].getAttribute('tabindex'), '0');
  assert.match(rows[0].querySelector('.bar').getAttribute('style'), /\* 1\)\)$/);
  assert.match(rows[1].querySelector('.bar').getAttribute('style'), /\* 0\.5\)\)$/);
  assert.equal(rows[1].querySelector('.bar-value').textContent, '15');
  assert.equal(rows[0].getAttribute('aria-label'), 'a.test · 50% of all: 30 links');
});

test('a bar list with a handler makes each row a button that picks its item', () => {
  const picked = [];
  const items = [{ name: 'Work', count: 0 }];
  const list = barList(items, { onSelect: (item) => picked.push(item), selectHint: 'Show these' });
  const row = list.querySelector('.bar-row');
  assert.equal(row.tagName, 'BUTTON');
  assert.equal(row.title, 'Show these');
  assert.equal(row.getAttribute('aria-label'), 'Work: 0 bookmarks');
  row.click();
  assert.deepEqual(picked, items);
});

test('marks show a tooltip on hover and focus and hide it when left', () => {
  const list = barList([{ name: 'a.test', count: 3 }]);
  document.body.append(list);
  const row = list.querySelector('.bar-row');
  row.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 200 }));
  const tip = tooltip();
  assert.equal(tip.hidden, false);
  assert.equal(tip.querySelector('strong').textContent, '3 bookmarks');
  assert.equal(tip.querySelector('span').textContent, 'a.test');
  assert.equal(tip.style.left, '112px');
  assert.equal(tip.style.top, '148px');
  row.dispatchEvent(new PointerEvent('pointerleave'));
  assert.equal(tip.hidden, true);

  row.getBoundingClientRect = () => ({ left: 1270, top: 5, width: 20, height: 10 });
  row.dispatchEvent(new FocusEvent('focus'));
  assert.equal(tip.hidden, false);
  assert.equal(tip.style.left, `${window.innerWidth - 160 - 12}px`);
  assert.equal(tip.style.top, '12px');
  row.dispatchEvent(new FocusEvent('blur'));
  assert.equal(tip.hidden, true);
  list.remove();
});

test('the tooltip is made again when something removed it from the page', () => {
  tooltip().remove();
  const list = barList([{ name: 'x', count: 1 }]);
  list.querySelector('.bar-row').dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 0 }));
  assert.equal(document.querySelectorAll('.viz-tooltip').length, 1);
  assert.equal(tooltip().hidden, false);
});

test('niceCeil rounds up to an even 1, 2 or 5 times a power of ten', () => {
  assert.equal(niceCeil(0), 2);
  assert.equal(niceCeil(2), 2);
  assert.equal(niceCeil(3), 6);
  assert.equal(niceCeil(7), 10);
  assert.equal(niceCeil(11), 20);
  assert.equal(niceCeil(45), 50);
  assert.equal(niceCeil(100), 100);
  assert.equal(niceCeil(101), 200);
});

test('a column chart draws round gridlines and labels only the busiest column', () => {
  const items = [{ month: 'Jan', count: 4 }, { month: 'Feb', count: 9 }, { month: 'Mar', count: 0 }];
  const chart = columnChart(items, { labelOf: (i) => `${i.month} 2024`, shortLabelOf: (i, n) => `${i.month[0]}${n}` });
  assert.deepEqual([...chart.querySelectorAll('.col-axis span')].map((s) => s.textContent), ['10', '5', '0']);
  assert.equal(chart.querySelectorAll('.col-grid span').length, 3);
  const cols = chart.querySelectorAll('.col');
  assert.equal(cols.length, 3);
  assert.deepEqual([...chart.querySelectorAll('.col-peak')].map((s) => s.textContent), ['9']);
  assert.equal(cols[1].querySelector('.col-bar').getAttribute('style'), 'height: 90%');
  assert.equal(cols[0].getAttribute('aria-label'), 'Jan 2024: 4 added');
  assert.deepEqual([...chart.querySelectorAll('.col-labels span')].map((s) => s.textContent), ['J0', 'F1', 'M2']);
});

test('a column chart with nothing in it labels no column', () => {
  const chart = columnChart([{ count: 0 }], { labelOf: () => 'May', shortLabelOf: () => 'M', unit: 'visits' });
  assert.equal(chart.querySelector('.col-peak'), null);
  assert.equal(chart.querySelector('.col').getAttribute('aria-label'), 'May: 0 visits');
  assert.equal(columnChart([], { labelOf: String, shortLabelOf: String }).querySelectorAll('.col').length, 0);
});

test('a chart card switches between the chart and a table of the same numbers', () => {
  const chart = document.createElement('div');
  const card = chartCard({ title: 'By site', subtitle: 'Top ten', tip: 'Where they point', chart, columns: ['Site', 'Count'], rows: [['a.test', 1500]], wide: true });
  assert.equal(card.className, 'viz-card wide');
  assert.match(card.querySelector('h2').textContent, /^By site \?$/);
  assert.equal(card.querySelector('.help-link').getAttribute('href'), '#help:stats');
  assert.equal(card.querySelector('.viz-head p').textContent, 'Top ten');
  assert.deepEqual([...card.querySelectorAll('th')].map((th) => th.textContent), ['Site', 'Count']);
  const cells = card.querySelectorAll('td');
  assert.equal(cells[0].textContent, 'a.test');
  assert.equal(cells[0].hasAttribute('class'), false);
  assert.equal(cells[1].className, 'num');
  assert.equal(cells[1].textContent, fmt(1500));

  const table = card.querySelector('table');
  const body = card.querySelector('.viz-body');
  const toggle = card.querySelector('.viz-head button');
  assert.equal(table.hidden, true);
  toggle.click();
  assert.equal(table.hidden, false);
  assert.equal(body.hidden, true);
  assert.equal(toggle.textContent, 'Chart');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  toggle.click();
  assert.equal(table.hidden, true);
  assert.equal(body.hidden, false);
  assert.equal(toggle.textContent, 'Table');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
});

test('a plain chart card has no help link or subtitle', () => {
  const card = chartCard({ title: 'Plain', chart: 'x', columns: [], rows: [] });
  assert.equal(card.className, 'viz-card');
  assert.equal(card.querySelector('h2').textContent, 'Plain');
  assert.equal(card.querySelector('.help-link'), null);
  assert.equal(card.querySelector('.viz-head p'), null);
});
