// Runs `task` over the items a few at a time until they are done, or `stop` says to give up.
export async function eachLimited(items, concurrency, task, stop = () => false) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stop()) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
}
