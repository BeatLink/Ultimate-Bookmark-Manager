// Dashboard: totals, what needs tidying, and charts of sites, locations, folder sizes and when bookmarks were added.

import { h, formatDate } from '../dom.js';
import { viewHeader, emptyState } from '../components.js';
import { treeStats } from '../../lib/stats.js';
import { statTile, barList, columnChart, chartCard, fmt } from '../charts.js';
import { plan } from './organize.js';
import { showInAll } from './all.js';
import * as scans from '../scans.js';

const TOP_SITES = 15;
const TOP_FOLDERS = 10;

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

    const dupes = scans.duplicates(ctx).groups.reduce((n, g) => n + g.items.length - 1, 0);
    const links = scans.linkResults(ctx);
    const broken = links ? links.results.filter((r) => r.status !== 'redirect').length : null;
    const redirects = links ? links.results.filter((r) => r.status === 'redirect').length : null;
    const organize = ctx.memo('organize', () => plan(ctx, ctx.state.settings.organize.rules)).moves.length;
    const ignored = Object.keys(ctx.state.whitelist).length;
    const notChecked = 'Not checked yet';

    const tidy = h('div', { class: 'stat-row' },
      statTile({ label: 'Duplicate copies', value: dupes, href: '#duplicates', tip: 'Extra copies of the same URL', muted: !dupes }),
      statTile({ label: 'No useful name', value: scans.untitled(ctx).length, href: '#untitled', muted: !scans.untitled(ctx).length }),
      statTile({ label: 'Empty folders', value: scans.emptyFolders(ctx).length, href: '#empty-folders', muted: !scans.emptyFolders(ctx).length }),
      statTile({ label: 'Same-name folders', value: scans.sameNameFolders(ctx).length, href: '#same-name', tip: 'Sets of sibling folders that could be merged', muted: !scans.sameNameFolders(ctx).length }),
      statTile({ label: 'Broken links', value: broken ?? '–', href: '#broken', note: links ? `checked ${formatDate(links.time)}` : notChecked, muted: !broken }),
      statTile({ label: 'Redirects', value: redirects ?? '–', href: '#redirects', note: links ? `checked ${formatDate(links.time)}` : notChecked, muted: !redirects }),
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
      subtitle: `${monthLabel(months[0].month)} to ${monthLabel(months.at(-1).month)}${months.length === 36 ? ' (the last three years)' : ''}.`,
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
      h('div', { class: 'viz-grid' }, monthsCard, sitesCard, rootsCard, foldersCard, protocolsCard),
      facts);
  },
};
