import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, titleFromHtml, readTitle } from '../src/lib/html-title.js';

// A response whose body arrives in the given chunks, recording whether it was cancelled.
function response(chunks, contentType) {
  const state = { cancelled: false, reads: 0 };
  const body = new ReadableStream({
    pull(c) {
      if (state.reads >= chunks.length) return c.close();
      const chunk = chunks[state.reads++];
      c.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
    },
    cancel() { state.cancelled = true; },
  });
  const headers = contentType === undefined ? undefined : new Headers(contentType ? { 'content-type': contentType } : {});
  return { res: { headers, body }, state };
}

test('named, decimal and hex entities are decoded and unknown or impossible ones kept as written', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &Mdash; &#65;&#x42;&#X43; &hellip;'), 'Tom & Jerry — ABC …');
  assert.equal(decodeEntities('&bogus; &#x110000; &#99999999;'), '&bogus; &#x110000; &#99999999;');
});

test('the title tag wins over og:title, which is used when the title is missing or blank', () => {
  assert.equal(titleFromHtml('<title> Real\n  page </title><meta property="og:title" content="OG">'), 'Real page');
  assert.equal(titleFromHtml('<title>  </title><meta property="og:title" content="Open &amp; Graph">'), 'Open & Graph');
  assert.equal(titleFromHtml("<meta property='og:title' content='Single quoted'>"), 'Single quoted');
  assert.equal(titleFromHtml('<meta property="og:title">'), '');
  assert.equal(titleFromHtml('<p>no title</p>'), '');
});

test('a page that is not HTML gives no title and its body is cancelled unread', async () => {
  const { res, state } = response(['<title>PDF?</title>'], 'application/pdf');
  assert.equal(await readTitle(res), '');
  assert.equal(state.reads, 0);
  assert.equal(state.cancelled, true);
});

test('a response without headers is read as HTML', async () => {
  const { res } = response(['<title>No headers</title>'], undefined);
  assert.equal(await readTitle(res), 'No headers');
});

test('a response without a readable body gives no title', async () => {
  assert.equal(await readTitle({ headers: new Headers({ 'content-type': 'text/html' }), body: null }), '');
});

test('reading stops once the title closes, or once the body starts without one', async () => {
  const closed = response(['<html><head><tit', 'le>Split</title>', '<p>rest</p>', 'never read'], 'text/html');
  assert.equal(await readTitle(closed.res), 'Split');
  assert.equal(closed.state.reads, 2);
  assert.equal(closed.state.cancelled, true);
  const body = response(['<head></head><body>', '<title>late</title>'], 'text/html');
  assert.equal(await readTitle(body.res), '');
  assert.equal(body.state.reads, 1);
});

test('reading gives up after the first half megabyte', async () => {
  const filler = 'x'.repeat(256 * 1024);
  const { res, state } = response([filler, filler, '<title>Too far</title>'], 'text/html');
  assert.equal(await readTitle(res), '');
  assert.equal(state.reads, 2);
});

test('the character set comes from the header, else a meta tag, and a bad name falls back to UTF-8', async () => {
  const latin1 = new Uint8Array([...new TextEncoder().encode('<title>Caf'), 0xe9, ...new TextEncoder().encode('</title>')]);
  assert.equal(await readTitle(response([latin1], 'text/html; charset=ISO-8859-1').res), 'Café');
  const meta = new Uint8Array([...new TextEncoder().encode('<meta charset="windows-1252"><title>Caf'), 0xe9, ...new TextEncoder().encode('</title>')]);
  assert.equal(await readTitle(response([meta], 'text/html').res), 'Café');
  assert.equal(await readTitle(response(['<title>Café</title>'], 'text/html; charset=no-such-set').res), 'Café');
  assert.equal(await readTitle(response(['<title>Café</title>'], 'application/xhtml+xml').res), 'Café');
});
