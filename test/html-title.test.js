import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFromHtml, decodeEntities } from '../src/lib/html-title.js';

test('titles come from the HTML, decoded, with og:title as a fallback', () => {
  assert.equal(titleFromHtml('<html><head><title>\n  Tom &amp; Jerry &#8211; &#x41;\n</title>'), 'Tom & Jerry – A');
  assert.equal(titleFromHtml('<title></title><meta property="og:title" content="From OG">'), 'From OG');
  assert.equal(titleFromHtml('<p>no title</p>'), '');
});

test('entities decode by name and number, and unknown ones are left as written', () => {
  assert.equal(decodeEntities('&lt;a&gt; &amp; &#38; &#x26; &nbsp;x'), '<a> & & &  x');
  assert.equal(decodeEntities('&bogus; &#1114112;'), '&bogus; &#1114112;');
});
