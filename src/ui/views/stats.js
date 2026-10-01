// Dashboard: totals, what needs tidying, and charts of sites, locations, folder sizes and when bookmarks were added.

import { h, formatDate } from '../dom.js';
import { viewHeader, emptyState } from '../components.js';
import { treeStats, MAX_MONTHS } from '../../lib/stats.js';
import { bookmarksOnly } from '../../lib/tree.js';
import { statTile, barList, columnChart, chartCard, fmt } from '../charts.js';
import { showInAll } from './all/state.js';
import * as scans from '../scans.js';

const TOP_SITES = 15;
const TOP_FOLDERS = 10;
const RECENT = 10;

const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

// Under the columns: the year at each January and at the first column, blank elsewhere so labels never collide.
const monthTick = (item, i) => (i === 0 || item.month.endsWith('-01') ? item.month.slice(0, 4) : '');

export default {
  id: 'stats',
  label: 'Dashboard',

  render(ctx) {
    const s = ctx.memo('stats', () => treeStats(ctx.state.flat));
    const header = viewHeader('Dashboard', 'Select a number to open the page that deals with it');
    if (!s.bookmarks) return h('section', {}, header, emptyState('No bookmarks yet.'));

    const dupes = scans.duplicates(ctx).extra;
    const links = scans.linkResults(ctx);
    const broken = scans.broken(ctx)?.length;
    const redirects = scans.redirects(ctx)?.length;
    const organize = scans.organizePlan(ctx).moves.length;
    const ignored = Object.keys(ctx.state.whitelist).length;
    const untitled = scans.untitled(ctx).length;
    const empty = scans.emptyFolders(ctx).length;
    const sameName = scans.sameNameFolders(ctx).length;
    const checkNote = links ? `checked ${formatDate(links.time)}` : 'Not checked yet';

    const tidy = h('div', { class: 'stat-row' },
      statTile({ label: 'Duplicate copies', value: dupes, href: '#duplicates', tip: 'Extra copies of the same URL', muted: !dupes }),
      statTile({ label: 'No useful name', value: untitled, href: '#untitled', muted: !untitled }),
      statTile({ label: 'Empty folders', value: empty, href: '#empty-folders', muted: !empty }),
      statTile({ label: 'Same-name folders', value: sameName, href: '#same-name', tip: 'Sets of sibling folders that could be merged', muted: !sameName }),
      statTile({ label: 'Broken links', value: broken ?? '–', href: '#broken', note: checkNote, muted: !broken }),
      statTile({ label: 'Redirects', value: redirects ?? '–', href: '#redirects', note: checkNote, muted: !redirects }),
      statTile({ label: 'Waiting to be organized', value: organize, href: '#organize', tip: 'Bookmarks your rules would move', muted: !organize }),
      statTile({ label: 'Ignored', value: ignored, href: '#settings', tip: 'Skipped by every check', muted: !ignored }));

    const topSites = s.sites.slice(0, TOP_SITES);
    const shownShare = Math.round((100 * topSites.reduce((n, x) => n + x.count, 0)) / s.bookmarks);
    const sitesCard = chartCard({
      title: 'Bookmarks by site',
      subtitle: `Top ${topSites.length} of ${fmt(s.sites.length)} sites, holding ${shownShare}% of all bookmarks.`,
      tip: 'Subdomains count as their site; select a site to list its bookmarks',
      chart: barList(topSites, { total: s.bookmarks, onSelect: (site) => showInAll(ctx, site.name.startsWith('(') ? '' : site.name), selectHint: 'List these bookmarks' }),
      columns: ['Site', 'Bookmarks', 'Share'],
      rows: s.sites.map((x) => [x.name, x.count, `${((100 * x.count) / s.bookmarks).toFixed(1)}%`]),
    });

    const months = s.months;
    const monthsCard = months.length > 1 && chartCard({
      title: 'Added per month',
      subtitle: `${monthLabel(months[0].month)} to ${monthLabel(months.at(-1).month)}${months.length === MAX_MONTHS ? ' (the last three years)' : ''}.`,
      chart: columnChart(months, { labelOf: (m) => monthLabel(m.month), shortLabelOf: monthTick }),
      columns: ['Month', 'Added'],
      rows: months.map((m) => [monthLabel(m.month), m.count]),
      wide: true,
    });

    const rootsCard = chartCard({
      title: 'Where they are',
      tip: 'Bookmarks under each top-level folder, subfolders included',
      chart: barList(s.roots, { total: s.bookmarks }),
      columns: ['Folder', 'Bookmarks'],
      rows: s.roots.map((x) => [x.name, x.count]),
    });

    const topFolders = s.largestFolders.slice(0, TOP_FOLDERS);
    const foldersCard = chartCard({
      title: 'Largest folders',
      subtitle: `Top ${topFolders.length} of ${fmt(s.largestFolders.length)} folders that hold any.`,
      tip: 'Bookmarks directly inside each folder, not counting subfolders',
      chart: barList(topFolders, { total: s.bookmarks }),
      columns: ['Folder', 'Bookmarks'],
      rows: s.largestFolders.map((x) => [x.name, x.count]),
    });

    const protocolsCard = chartCard({
      title: 'URL types',
      tip: 'Plain http URLs are not encrypted; other types include bookmarklets and Firefox’s own pages',
      chart: barList(s.protocols, { total: s.bookmarks }),
      columns: ['Type', 'Bookmarks'],
      rows: s.protocols.map((x) => [x.name, x.count]),
    });

    const recent = bookmarksOnly(ctx.state.flat).sort((a, b) => b.dateAdded - a.dateAdded).slice(0, RECENT);
    const recentCard = h('div', { class: 'viz-card' },
      h('div', { class: 'viz-head' },
        h('div', {}, h('h2', { text: 'Recently bookmarked' }), h('p', { class: 'muted small', text: `The newest ${recent.length}, newest first.` })),
        h('button', { class: 'small', type: 'button', text: 'See all', title: 'List every bookmark, newest first', onclick: () => showInAll(ctx, '', 'recent') })),
      h('ol', { class: 'recent-list' }, recent.map((b) => h('li', {},
        h('a', { href: b.url, target: '_blank', rel: 'noreferrer', title: b.url, text: b.title || b.url }),
        h('span', { class: 'muted small', text: formatDate(b.dateAdded) })))));

    const fact = (label, value, detail) => h('div', { class: 'fact' }, h('span', { class: 'stat-label', text: label }), h('span', { class: 'fact-value', text: value }), detail);
    const bmLink = (b) => b && h('a', { href: b.url, target: '_blank', rel: 'noreferrer', class: 'small', text: b.title || b.url });
    const facts = h('div', { class: 'facts' },
      s.oldest && fact('Oldest bookmark', formatDate(s.oldest.dateAdded), bmLink(s.oldest)),
      s.newest && fact('Newest bookmark', formatDate(s.newest.dateAdded), bmLink(s.newest)),
      fact('Deepest folder level', fmt(s.deepest)),
      fact('Separators', fmt(s.separators)));

    return h('section', { class: 'dashboard' },
      header,
      h('div', { class: 'stat-row hero-row' },
        statTile({ label: 'Bookmarks', value: s.bookmarks, hero: true, href: '#all', note: `in ${fmt(s.folders)} folders, from ${fmt(s.sites.length)} sites` })),
      h('h2', { class: 'section-title', text: 'To tidy up' }),
      tidy,
      h('div', { class: 'viz-grid' }, monthsCard, recentCard, sitesCard, rootsCard, foldersCard, protocolsCard),
      facts);
  },
};
