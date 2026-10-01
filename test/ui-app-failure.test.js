import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, settle, uninstallDom } from './browser-env.js';

const browser = installBrowser({ page: 'app.html' });
browser.bookmarks.getTree = async () => { throw new Error('Bookmarks are locked'); };
after(uninstallDom);

test('the dashboard says why when it cannot load the bookmarks', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (err) => logged.push(err.message));
  await import('../src/ui/app.js');
  await settle(20);
  const error = document.querySelector('#main p.error');
  assert.equal(error.textContent, 'Failed to load bookmarks: Bookmarks are locked');
  assert.deepEqual(logged, ['Bookmarks are locked']);
});
