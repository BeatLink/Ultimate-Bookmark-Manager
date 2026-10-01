import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POINTS, URL_TIER, splitScore, formatScore, domainPoints, pathPoints, prefixPoints, urlTextPoints, valuePoints } from '../src/lib/specificity.js';

test('a score splits into its URL and keyword parts and reads as both', () => {
  assert.deepEqual(splitScore(110 * URL_TIER + 40), { url: 110, keywords: 40 });
  assert.equal(formatScore(110 * URL_TIER + 40), 'URL 110 + keywords 40');
  assert.equal(formatScore(50 * URL_TIER), 'URL 50');
  assert.equal(formatScore(20), 'keywords 20');
  assert.equal(formatScore(0), '0');
});

test('a domain scores as a site or a subdomain, counting country second levels as part of the site', () => {
  assert.equal(domainPoints('example.com'), POINTS.domain);
  assert.equal(domainPoints('www.example.com'), POINTS.domain);
  assert.equal(domainPoints('*.example.com'), POINTS.domain);
  assert.equal(domainPoints('blog.example.com'), POINTS.subdomain);
  assert.equal(domainPoints('bbc.co.uk'), POINTS.domain);
  assert.equal(domainPoints('news.bbc.co.uk'), POINTS.subdomain);
  assert.equal(domainPoints('a.b.de'), POINTS.subdomain);
});

test('a path scores by its segments and a bare slash as a keyword', () => {
  assert.equal(pathPoints('/a/b'), POINTS.path + 2 * POINTS.pathSegment);
  assert.equal(pathPoints('/'), POINTS.keyword);
});

test('a URL prefix scores by its path depth, a bare site as a domain, and an unreadable one as a keyword', () => {
  assert.equal(prefixPoints('https://example.com/docs/api'), POINTS.path + 2 * POINTS.pathSegment);
  assert.equal(prefixPoints('example.com/docs'), POINTS.path + POINTS.pathSegment);
  assert.equal(prefixPoints('blog.example.com'), POINTS.subdomain);
  assert.equal(prefixPoints('http://[bad'), POINTS.keyword);
});

test('text found in a URL scores as a site and path when it spells one, a path when it starts with a slash, else a keyword', () => {
  assert.equal(urlTextPoints('youtube.com/@channel'), POINTS.path + POINTS.pathSegment);
  assert.equal(urlTextPoints('https://example.com'), POINTS.domain);
  assert.equal(urlTextPoints('/watch/later'), POINTS.path + 2 * POINTS.pathSegment);
  assert.equal(urlTextPoints('v1.2'), POINTS.keyword);
});

test('each operator scores by the part of the bookmark it matched', () => {
  assert.equal(valuePoints('onDomain', 'blog.example.com', 'host'), POINTS.subdomain);
  assert.equal(valuePoints('contains', 'example.com', 'host'), POINTS.domain);
  assert.equal(valuePoints('contains', 'docs/api', 'path'), POINTS.path + 2 * POINTS.pathSegment);
  assert.equal(valuePoints('contains', 'example.com/x', 'url'), POINTS.path + POINTS.pathSegment);
  assert.equal(valuePoints('beginsWith', 'example.com/x', 'url'), POINTS.path + POINTS.pathSegment);
  assert.equal(valuePoints('beginsWith', '/a/b/c', 'path'), POINTS.path + 3 * POINTS.pathSegment);
  assert.equal(valuePoints('contains', 'rust', 'title'), POINTS.keyword);
  assert.equal(valuePoints('hasParam', 'v=1', 'query'), POINTS.paramValue);
  assert.equal(valuePoints('hasParam', 'v', 'query'), POINTS.param);
  assert.equal(valuePoints('matchesRegex', 'a+', 'url'), POINTS.regex);
  assert.equal(valuePoints('=', 'https://a.test/', 'url'), POINTS.exactUrl);
  assert.equal(valuePoints('=', 'a.b.test', 'host'), POINTS.subdomain);
  assert.equal(valuePoints('=', '/a', 'path'), POINTS.path + 2 * POINTS.pathSegment);
  assert.equal(valuePoints('=', 'q=1', 'query'), POINTS.exactQuery);
  assert.equal(valuePoints('=', 'Home', 'title'), POINTS.exactTitle);
  assert.equal(valuePoints('endsWith', '.pdf', 'url'), POINTS.keyword);
});
