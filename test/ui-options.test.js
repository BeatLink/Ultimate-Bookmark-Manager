import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, uninstallDom } from './browser-env.js';

installBrowser({ url: 'moz-extension://test/src/ui/options.html' });
after(uninstallDom);

test('the add-on preferences page forwards to the dashboard settings without adding a history entry', async (t) => {
  const replaced = [];
  t.mock.method(location, 'replace', (url) => replaced.push(url));
  await import('../src/ui/options.js');
  assert.deepEqual(replaced, ['app.html#settings']);
});
