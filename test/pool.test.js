import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eachLimited } from '../src/lib/pool.js';

// ============================================================================
// Pacing pages on the same site
// ============================================================================

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs a short task per item and records when each one started and finished.
async function run_paced(items, concurrency, gap, stop) {
  const log = [];
  const task = async (item) => {
    const entry = { item, start: Date.now() };
    log.push(entry);
    await sleep(10);
    entry.end = Date.now();
  };
  await eachLimited(items, concurrency, task, stop, { gap, keyOf: (item) => item[0] });
  return log;
}

test('pages on one site run one at a time with the gap between them', async () => {
  const log = await run_paced(['a1', 'a2', 'a3'], 4, 40);

  assert.deepEqual(log.map((entry) => entry.item), ['a1', 'a2', 'a3']);
  for (let index = 1; index < log.length; index++) {
    assert.ok(log[index].start >= log[index - 1].end + 35, `a${index + 1} waits for the gap`);
  }
});

test('other sites carry on while one site waits', async () => {
  const log = await run_paced(['a1', 'a2', 'b1', 'c1'], 4, 60);
  const started = Object.fromEntries(log.map((entry) => [entry.item, entry.start]));

  assert.ok(started.b1 < started.a2 && started.c1 < started.a2, 'b and c do not wait behind a');
  assert.ok(started.a2 - started.a1 >= 60);
});

test('a stop while waiting ends the run without starting the rest', async () => {
  let stopped = false;
  setTimeout(() => { stopped = true; }, 30);

  const begun = Date.now();
  const log = await run_paced(['a1', 'a2'], 2, 5000, () => stopped);

  assert.deepEqual(log.map((entry) => entry.item), ['a1']);
  assert.ok(Date.now() - begun < 1000, 'the stop is noticed long before the gap ends');
});

test('a failing page passes its error to the caller', async () => {
  const task = async (item) => {
    if (item === 'a1') throw new Error('page failed');
  };

  await assert.rejects(eachLimited(['a1', 'a2'], 1, task, undefined, { gap: 10, keyOf: (item) => item[0] }), /page failed/);
});
