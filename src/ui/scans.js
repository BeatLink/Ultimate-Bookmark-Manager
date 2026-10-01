// Memoised scans over the loaded tree, shared by views and their navigation badges.

import { findDuplicates } from '../lib/duplicates.js';
import { findEmptyFolders, findSameNameFolders, findUntitled } from '../lib/folders.js';
import { planMoves } from '../lib/organize.js';
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

// The last plan worked out, reused until the bookmarks, the ignore list or the rules change.
let lastPlan = { flat: null, whitelist: null, key: '', result: null };

// Where the given organize rules would move bookmarks; the Organize page passes its unsaved draft.
export function planFor(ctx, rules) {
  const key = JSON.stringify(rules);
  const { flat, whitelist } = ctx.state;
  if (lastPlan.flat === flat && lastPlan.whitelist === whitelist && lastPlan.key === key) return lastPlan.result;
  const result = planMoves(flat, rules, rootFoldersOf(ctx.state.root), ctx.ignoredIds());
  lastPlan = { flat, whitelist, key, result };
  return result;
}

// Where the saved organize rules would move bookmarks.
export const organizePlan = (ctx) => ctx.memo('organize', () => planFor(ctx, ctx.state.settings.organize.rules));
