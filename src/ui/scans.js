// Memoised scans over the loaded tree, shared by views and their navigation badges.

import { findDuplicates } from '../lib/duplicates.js';
import { findEmptyFolders, findSameNameFolders, findUntitled } from '../lib/folders.js';
import { planRules, knownPages } from '../lib/rule-plan.js';
import { rootFoldersOf } from '../lib/tree.js';

export const duplicates = (ctx) => ctx.memo('duplicates', () => findDuplicates(ctx.state.flat, {
  matching: ctx.state.settings.matching,
  rules: ctx.state.settings.duplicateRules,
  ignoredIds: ctx.ignoredIds(),
}));

export const emptyFolders = (ctx) => ctx.memo('empty', () => findEmptyFolders(ctx.state.root, ctx.ignoredIds()));

export const sameNameFolders = (ctx) => ctx.memo('same-name', () => findSameNameFolders(ctx.state.root, ctx.ignoredIds()));

export const untitled = (ctx) => ctx.memo('untitled', () => findUntitled(ctx.state.flat, ctx.ignoredIds()));

// Saved link-check results, minus bookmarks that have since been removed, edited or whitelisted.
export const linkResults = (ctx) => ctx.memo('links', () => {
  const saved = ctx.state.linkResults;
  if (!saved) return null;
  const byId = new Map(ctx.state.flat.map((b) => [b.id, b]));
  const ignored = ctx.ignoredIds();
  const results = [];
  for (const r of saved.results) {
    const b = byId.get(r.id);
    if (b?.url === r.url && !ignored.has(r.id)) results.push({ ...b, ...r, title: b.title, path: b.path });
  }
  return { ...saved, results };
});

// The broken and uncertain links of the last check, or null before any check.
export const broken = (ctx) => linkResults(ctx)?.results.filter((r) => r.status !== 'redirect') ?? null;

// The redirects of the last check, or null before any check.
export const redirects = (ctx) => linkResults(ctx)?.results.filter((r) => r.status === 'redirect') ?? null;

// The last plan worked out, reused until the bookmarks, the ignore list, the link check or the rules change.
let lastPlan = { flat: null, whitelist: null, links: null, key: '', result: null };

// What the given rules would do to bookmarks; the Rules page passes its unsaved draft, and `pages` adds pages read just now.
export function planFor(ctx, rules, pages = null) {
  const key = JSON.stringify(rules);
  const { flat, whitelist, linkResults } = ctx.state;
  if (!pages && lastPlan.flat === flat && lastPlan.whitelist === whitelist && lastPlan.links === linkResults && lastPlan.key === key) return lastPlan.result;
  const known = new Map([...knownPages(linkResults), ...(pages ?? [])]);
  const result = planRules(flat, rules, rootFoldersOf(ctx.state.root), { ignoredIds: ctx.ignoredIds(), pages: known });
  if (!pages) lastPlan = { flat, whitelist, links: linkResults, key, result };
  return result;
}

// What the saved rules would do to bookmarks.
export const rulesPlan = (ctx) => ctx.memo('rules', () => planFor(ctx, ctx.state.settings.organize.rules));
