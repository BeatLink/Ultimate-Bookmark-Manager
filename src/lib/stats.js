// Numbers for the dashboard: totals, sites, where bookmarks live, folder sizes and when they were added.

// Second-level labels that belong to the country ending, so "bbc.co.uk" stays one site.
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ne', 'or']);

// The site a bookmark belongs to: "docs.python.org" gives "python.org"; non-web URLs are grouped by kind.
export function siteOf(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return '(invalid URL)';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return `(${u.protocol.replace(/:$/, '')})`;
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return host;
  const labels = host.split('.');
  const keep = labels.length >= 3 && labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2)) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

export function protocolOf(url) {
  try {
    return new URL(url).protocol.replace(/:$/, '');
  } catch {
    return 'invalid';
  }
}

const monthKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Every month from the first bookmark (at most `maxMonths` back) to `now`, including months with none added.
export function addedByMonth(bookmarks, now = Date.now(), maxMonths = 36) {
  const dated = bookmarks.filter((b) => b.dateAdded > 0);
  if (!dated.length) return [];
  const counts = new Map();
  for (const b of dated) counts.set(monthKey(b.dateAdded), (counts.get(monthKey(b.dateAdded)) ?? 0) + 1);
  const end = new Date(now);
  const first = new Date(dated.reduce((min, b) => Math.min(min, b.dateAdded), Infinity));
  let y = first.getFullYear();
  let m = first.getMonth();
  const earliest = new Date(end.getFullYear(), end.getMonth() - (maxMonths - 1), 1);
  if (new Date(y, m, 1) < earliest) {
    y = earliest.getFullYear();
    m = earliest.getMonth();
  }
  const months = [];
  while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    months.push({ month: key, count: counts.get(key) ?? 0 });
    m++;
    if (m === 12) { m = 0; y++; }
  }
  return months;
}

function tally(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// Everything the dashboard shows about the bookmark tree itself; health checks come from the other views' scans.
export function treeStats(flat, now = Date.now()) {
  const bookmarks = flat.filter((n) => n.type === 'bookmark');
  const folders = flat.filter((n) => n.type === 'folder');
  const direct = new Map();
  for (const b of bookmarks) direct.set(b.parentId, (direct.get(b.parentId) ?? 0) + 1);
  const byDate = [...bookmarks].filter((b) => b.dateAdded > 0).sort((a, b) => a.dateAdded - b.dateAdded);
  return {
    bookmarks: bookmarks.length,
    folders: folders.length,
    separators: flat.filter((n) => n.type === 'separator').length,
    sites: tally(bookmarks.map((b) => siteOf(b.url))),
    protocols: tally(bookmarks.map((b) => protocolOf(b.url))),
    roots: tally(bookmarks.map((b) => b.path[0] ?? '(top level)')),
    largestFolders: folders
      .map((f) => ({ name: [...f.path, f.title].join(' › '), count: direct.get(f.id) ?? 0 }))
      .filter((f) => f.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    deepest: bookmarks.reduce((max, b) => Math.max(max, b.path.length), 0),
    months: addedByMonth(bookmarks, now),
    oldest: byDate[0] ?? null,
    newest: byDate.at(-1) ?? null,
  };
}
