// Runs tasks over many items a few at a time, optionally pacing the items that share a site.

// The longest a waiting worker sleeps before looking again, so a cancel is noticed quickly.
const LOOK_AGAIN_MS = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs `task` over the items a few at a time until they are done, or `stop` says to give up; with a `gap`, items sharing a `keyOf` run one at a time with that many milliseconds between them.
export async function eachLimited(items, concurrency, task, stop = () => false, { gap = 0, keyOf } = {}) {
  if (gap > 0) return eachPaced(items, concurrency, task, stop, gap, keyOf);
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stop()) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
}

async function eachPaced(items, concurrency, task, stop, gap, keyOf) {
  const queues = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(item);
  }
  const busy = new Set();
  const free_at = new Map();

  // The first item whose site is idle and done waiting, or how long until one may be.
  const pick = () => {
    const now = Date.now();
    let soonest = Infinity;
    for (const [key, queue] of queues) {
      if (busy.has(key)) continue;
      const at = free_at.get(key) ?? 0;
      if (at > now) {
        soonest = Math.min(soonest, at - now);
        continue;
      }
      const item = queue.shift();
      if (queue.length === 0) queues.delete(key);
      return { key, item };
    }
    return { wait: Math.min(soonest, LOOK_AGAIN_MS) };
  };

  const worker = async () => {
    while (queues.size > 0 && !stop()) {
      const picked = pick();
      if ('wait' in picked) {
        await sleep(picked.wait);
        continue;
      }
      busy.add(picked.key);
      try {
        await task(picked.item);
      } finally {
        busy.delete(picked.key);
        free_at.set(picked.key, Date.now() + gap);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
}
