// Plans where organize rules would move bookmarks, after checking the rules for problems.

import { FOLDER_OPS, ruleName, valueOf, allConditions, resolveTarget, folderPathOf, startsWithPath } from './rules.js';
import { matcher } from './matching.js';
import { formatScore } from './specificity.js';
import { buildOrder, rankCandidates, lostBecause } from './rule-order.js';

// Checks each rule once so the editor can show a problem next to the rule that has it; folders are checked only when `flat` is given.
export function validateRules(rules, rootFolders, flat = null) {
  const problems = new Map();
  const folders = flat && new Set(flat.filter((n) => n.type === 'folder').map((n) => [...n.path, n.title].join('\0')));
  for (const rule of rules) {
    const issues = [];
    const active = allConditions(rule.query).filter(valueOf);
    const inFolders = active.filter((c) => FOLDER_OPS.has(c.operator));
    if (active.length === inFolders.length) {
      issues.push('Add a condition on the title or URL; folder conditions only narrow a rule down.');
    }
    if (!resolveTarget(rule.target, rootFolders)) issues.push('Choose a target folder.');
    if (folders) {
      for (const c of inFolders) {
        const path = folderPathOf(valueOf(c), rootFolders);
        if (path && !folders.has(path.join('\0'))) issues.push(`The folder “${path.join(' › ')}” no longer exists.`);
      }
    }
    for (const c of active) {
      if (c.operator !== 'matchesRegex') continue;
      try {
        new RegExp(valueOf(c));
      } catch (err) {
        issues.push(`Invalid regex “${valueOf(c)}”: ${err.message}`);
      }
    }
    if (issues.length) problems.set(rule.id, issues);
  }
  return problems;
}

// Rules caught in a ranking loop or a link against the tiers, each with a note; the rules still run, only those links are ignored.
export function rankingWarnings(rules) {
  const warnings = new Map();
  const order = buildOrder(rules);
  const add = (r, text) => warnings.set(r.id, [...(warnings.get(r.id) ?? []), text]);
  const name = (r) => `“${ruleName(r)}”`;
  for (const loop of order.loops) {
    const names = loop.map(name).join(', ');
    for (const r of loop) add(r, `${names} rank above each other in a loop, so those links are ignored until one is removed.`);
  }
  for (const [high, low] of order.against) {
    const why = low.rankAll === 'above' ? `${name(low)} ranks above all other rules` : `${name(high)} ranks below all other rules`;
    for (const r of [high, low]) add(r, `${name(high)} is set to rank above ${name(low)}, but ${why}, so that link is ignored.`);
  }
  return warnings;
}

// One planned move, with every matching rule's standing worked out only when first read.
function moveFor(bookmark, best, ranked, order) {
  const standing = (c) => ({ ruleId: c.rule.id, ruleName: c.rule.name, target: c.target, score: c.score, why: c.match.explain(bookmark) });
  let ranking = null;
  return {
    bookmark,
    ...standing(best),
    others: ranked.length - 1,
    // Every matching rule, strongest first, each with what it matched and, below the winner, why it lost.
    get ranking() {
      ranking ??= ranked.map((c) => ({ ...standing(c), lost: c === best ? null : lostBecause(c, best, ranked, order, formatScore) }));
      return ranking;
    },
  };
}

// Works out where each bookmark should go, by the enabled, valid rule that wins the ranking of those matching it; `tree` is the whole tree when `flat` holds only some bookmarks.
export function planMoves(flat, rules, rootFolders, ignoredIds = new Set(), tree = flat) {
  const problems = validateRules(rules, rootFolders, tree);
  const order = buildOrder(rules);
  // Disabled rules are still scored so the editor can say what they would match; they never win.
  const valid = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => !problems.has(rule.id))
    .map((u) => ({ ...u, target: resolveTarget(u.rule.target, rootFolders), match: matcher(u.rule, rootFolders), on: u.rule.enabled !== false }));
  const moves = [];
  const unmatched = [];
  const wins = new Map();
  const matches = new Map();
  const count = (map, id) => map.set(id, (map.get(id) ?? 0) + 1);
  for (const b of flat) {
    if (b.type !== 'bookmark' || ignoredIds.has(b.id)) continue;
    const candidates = [];
    for (const u of valid) {
      const score = u.match.score(b);
      if (score === null) continue;
      count(matches, u.rule.id);
      if (u.on) candidates.push({ rule: u.rule, index: u.index, target: u.target, score, match: u.match });
    }
    if (!candidates.length) {
      unmatched.push(b);
      continue;
    }
    const ranked = candidates.length > 1 ? rankCandidates(candidates, order) : candidates;
    const best = ranked[0];
    count(wins, best.rule.id);
    // The winning rule decides even when the bookmark is already where it says, so a weaker rule cannot move it away.
    if (startsWithPath(b.path, best.target.path)) continue;
    moves.push(moveFor(b, best, ranked, order));
  }
  return { moves, unmatched, problems, wins, matches };
}
