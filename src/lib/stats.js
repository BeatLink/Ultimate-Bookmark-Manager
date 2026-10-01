// Numbers for the dashboard: totals, sites, where bookmarks live, folder sizes and when they were added.

import { siteOfHost } from './domains.js';
import { countBy } from './group.js';

// How many months the "added per month" chart shows at most.
export const MAX_MONTHS = 36;

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
  return siteOfHost(host);
}

export function protocolOf(url) {
  try {
    return new URL(url).protocol.replace(/:$/, '');
  } catch {
    return 'invalid';
  }
}

const monthKey = (year, month) => `${year}-${String(month + 1).padStart(2, '0')}`;
const monthOf = (ms) => {
  const d = new Date(ms);
  return monthKey(d.getFullYear(), d.getMonth());
};

// Every month from the first bookmark (at most `maxMonths` back) to `now`, including months with none added.
export function addedByMonth(bookmarks, now = Date.now(), maxMonths = MAX_MONTHS) {
  const dated = bookmarks.filter((b) => b.dateAdded > 0);
  if (!dated.length) return [];
  const counts = countBy(dated, (b) => monthOf(b.dateAdded));
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
    const key = monthKey(y, m);
    months.push({ month: key, count: counts.get(key) ?? 0 });
    m++;
    if (m === 12) { m = 0; y++; }
  }
  return months;
}

// Each distinct value with how often it occurs, most common first.
function tally(values) {
  return [...countBy(values, (v) => v)].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// Everything the dashboard shows about the bookmark tree itself; health checks come from the other views' scans.
export function treeStats(flat, now = Date.now()) {
  const bookmarks = flat.filter((n) => n.type === 'bookmark');
  const folders = flat.filter((n) => n.type === 'folder');
  const direct = countBy(bookmarks, (b) => b.parentId);
  const byDate = bookmarks.filter((b) => b.dateAdded > 0).sort((a, b) => a.dateAdded - b.dateAdded);
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
