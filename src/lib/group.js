// Sorting items into groups by a key.

// A Map from each key `keyOf` gives to the items that share it, in their original order.
export function groupBy(items, keyOf) {
  const out = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

// A Map from each key `keyOf` gives to how many items share it.
export function countBy(items, keyOf) {
  const out = new Map();
  for (const item of items) {
    const key = keyOf(item);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}
