import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, settle, uninstallDom } from './browser-env.js';

const browser = installBrowser({ page: 'app.html', url: 'moz-extension://test/src/ui/app.html?sidebar' });
await import('../src/ui/app.js');
await settle(20);
after(uninstallDom);

test('the dashboard in the sidebar marks the page as a sidebar', () => {
  assert.equal(document.body.classList.contains('sidebar'), true);
  assert.equal(document.getElementById('main').dataset.view, 'stats');
});

test('the sidebar leaves focus-dashboard messages to the full-page tab', async () => {
  assert.deepEqual(browser.runtime.onMessage.emit({ type: 'focus-dashboard', view: 'broken' }), [undefined]);
  await settle(5);
  assert.equal(document.getElementById('main').dataset.view, 'stats');
  assert.equal(browser.calls.some(([name]) => name === 'tabs.getCurrent'), false);
});
