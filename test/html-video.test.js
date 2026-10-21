import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, lengthFromHtml, readVideoLength, formatLength } from '../src/lib/html-video.js';
import { fakeFetch } from './fake-fetch.js';

test('ISO 8601 durations become seconds, and anything else is not one', () => {
  assert.equal(parseDuration('PT3M34S'), 214);
  assert.equal(parseDuration(' pt1h2m3s '), 3723);
  assert.equal(parseDuration('P1DT1S'), 86401);
  assert.equal(parseDuration('PT1.5S'), 1.5);
  assert.equal(parseDuration('PT'), null);
  assert.equal(parseDuration('3:34'), null);
  assert.equal(parseDuration(214), null);
});

test('the length comes from Open Graph, then schema.org tags, then JSON-LD, then YouTube’s player data', () => {
  assert.equal(lengthFromHtml('<meta content="95" property="og:video:duration"><meta itemprop="duration" content="PT1M">'), 95);
  assert.equal(lengthFromHtml("<meta name='video:duration' content='0'><meta itemprop=duration content=PT2M>"), 120);
  const ld = (data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  assert.equal(lengthFromHtml(ld({ '@graph': [{ '@type': 'WebPage' }, { '@type': ['VideoObject'], duration: 'PT1H' }] })), 3600);
  assert.equal(lengthFromHtml(`<script type="application/ld+json">{broken</script>${ld({ '@type': 'VideoObject', duration: 'PT0S' })}${ld([{ '@type': 'VideoObject', duration: 'PT7S' }])}`), 7);
  assert.equal(lengthFromHtml('<script>var p = {"videoDetails":{"lengthSeconds":"213"}}</script>'), 213);
  assert.equal(lengthFromHtml('<video src="a.mp4"></video>'), null);
});

test('a page is read only until its length turns up, and other files have none', async () => {
  const filler = 'x'.repeat(200 * 1024);
  const pages = {
    'https://v.test/': { html: `<html><body>${filler}<meta itemprop="duration" content="PT10S">${filler}` },
    'https://none.test/': { html: '<title>No video</title>' },
    'https://file.test/a.mp4': { html: 'binary', type: 'video/mp4' },
  };
  const get = (url) => fakeFetch(pages)(url);
  assert.equal(await readVideoLength(await get('https://v.test/')), 10);
  assert.equal(await readVideoLength(await get('https://none.test/')), null);
  assert.equal(await readVideoLength(await get('https://file.test/a.mp4')), null);
});

test('lengths show as m:ss or h:mm:ss', () => {
  assert.equal(formatLength(0), '');
  assert.equal(formatLength(null), '');
  assert.equal(formatLength(65), '1:05');
  assert.equal(formatLength(3723), '1:02:03');
});
