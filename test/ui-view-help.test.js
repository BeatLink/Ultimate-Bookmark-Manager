import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallDom, settle } from './browser-env.js';
import { openDashboard, main, show } from './ui-view-helpers.js';
import { POINTS } from '../src/lib/specificity.js';

// Records which help section was scrolled to.
const scrolled = [];
await openDashboard({ view: 'help' });
after(uninstallDom);
HTMLElement.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this.id); };

const sections = () => [...main().querySelectorAll('.help-section')];

test('the help page has a section for every page, listed in its table of contents', () => {
  assert.equal(main().querySelector('h1').textContent, 'Help');
  const ids = sections().map((s) => s.id);
  assert.deepEqual(ids, ['stats', 'duplicates', 'empty-folders', 'same-name', 'untitled', 'broken', 'redirects', 'organize', 'all', 'history', 'settings', 'shortcuts'].map((id) => `help-${id}`));
  const toc = [...main().querySelectorAll('.help-toc a')];
  assert.equal(toc.length, ids.length);
  assert.equal(toc[0].getAttribute('href'), '#help:stats');
  assert.equal(toc[0].textContent, 'Dashboard');
});

test('each section links to its page, except the one about opening the add-on', () => {
  for (const s of sections()) {
    const open = s.querySelector('.help-open');
    if (s.id === 'help-shortcuts') assert.equal(open, null);
    else assert.equal(open.getAttribute('href'), `#${s.id.slice(5)}`);
  }
});

test('the organize section quotes the points each kind of condition scores', () => {
  const organize = main().querySelector('#help-organize').textContent;
  assert.match(organize, new RegExp(`exact URL ${POINTS.exactUrl}`));
  assert.match(organize, new RegExp(`each regex ${POINTS.regex}`));
});

test('opening help at a page’s section scrolls to that section', async () => {
  await show('help:redirects');
  await settle(5);
  assert.deepEqual(scrolled, ['help-redirects']);
});

test('opening help without a section does not scroll', async () => {
  await show('stats');
  await show('help');
  await settle(5);
  assert.deepEqual(scrolled, ['help-redirects']);
});

test('a page’s help link opens the help at that page’s section', async () => {
  await show('duplicates');
  const link = main().querySelector('.view-header .help-link');
  assert.equal(link.getAttribute('href'), '#help:duplicates');
  await show('help:duplicates');
  await settle(5);
  assert.equal(scrolled.at(-1), 'help-duplicates');
});
