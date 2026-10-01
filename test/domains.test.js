import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bareDomain, onDomain, siteOfHost } from '../src/lib/domains.js';

test('domains as written lose their wildcard and case', () => {
  assert.equal(bareDomain(' *.Example.com '), 'example.com');
  assert.equal(bareDomain('.example.com'), 'example.com');
  assert.equal(bareDomain(undefined), '');
});

test('a host is on a domain when it is the domain or a name inside it', () => {
  assert.ok(onDomain('example.com', 'example.com'));
  assert.ok(onDomain('mail.example.com', 'example.com'));
  assert.ok(!onDomain('notexample.com', 'example.com'));
  assert.ok(!onDomain('example.com', ''));
});

test('the site of a host keeps country second levels', () => {
  assert.equal(siteOfHost('docs.python.org'), 'python.org');
  assert.equal(siteOfHost('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(siteOfHost('localhost'), 'localhost');
});
