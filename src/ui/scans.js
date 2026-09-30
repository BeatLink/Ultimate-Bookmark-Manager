// Memoised scans over the loaded tree, shared by views and their navigation badges.

import { findDuplicates } from '../lib/duplicates.js';
import { findEmptyFolders, findSameNameFolders, findUntitled } from '../lib/folders.js';

export const duplicates = (ctx) => ctx.memo('duplicates', () => findDuplicates(ctx.state.flat, {
  matching: ctx.state.settings.matching,
  rules: ctx.state.settings.rules,
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
  const results = saved.results
    .filter((r) => byId.get(r.id)?.url === r.url && !ignored.has(r.id))
    .map((r) => ({ ...byId.get(r.id), ...r, title: byId.get(r.id).title, path: byId.get(r.id).path }));
  return { ...saved, results };
});
