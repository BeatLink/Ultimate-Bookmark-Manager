// The order users set between rules: each rule lists the rules it ranks above, and the lists decide between related rules.

import { ruleName } from './rules.js';

// Groups of rules that rank above each other in a circle, found with Tarjan's algorithm; links inside such a group are ignored.
function loopGroups(rules, byId) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const groups = [];
  const visit = (id) => {
    index.set(id, counter);
    low.set(id, counter);
    counter++;
    stack.push(id);
    onStack.add(id);
    for (const next of byId.get(id)?.outranks ?? []) {
      if (!byId.has(next)) continue;
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id), index.get(next)));
      }
    }
    if (low.get(id) === index.get(id)) {
      const group = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        group.push(member);
      } while (member !== id);
      if (group.length > 1 || (byId.get(id)?.outranks ?? []).includes(id)) groups.push(group);
    }
  };
  for (const r of rules) if (!index.has(r.id)) visit(r.id);
  return groups;
}

// A rule set to rank above all other rules sits in the top tier, one set below them in the bottom tier, and the rest between.
function tierOf(rule) {
  return rule.rankAll === 'above' ? 2 : rule.rankAll === 'below' ? 0 : 1;
}

// Everything each rule ranks above, following the lists through other rules and leaving out links inside a loop or against the tiers.
export function buildOrder(rules) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const loops = loopGroups(rules, byId);
  const loopOf = new Map();
  loops.forEach((group, i) => group.forEach((id) => loopOf.set(id, i)));
  const against = [];
  const keeps = (r, id) => {
    if (!byId.has(id) || id === r.id || (loopOf.has(r.id) && loopOf.get(r.id) === loopOf.get(id))) return false;
    if (tierOf(r) >= tierOf(byId.get(id))) return true;
    against.push([r, byId.get(id)]);
    return false;
  };
  const direct = new Map(rules.map((r) => [r.id, (r.outranks ?? []).filter((id) => keeps(r, id))]));
  const below = new Map();
  const reach = (id) => {
    if (below.has(id)) return below.get(id);
    const set = new Set();
    below.set(id, set);
    for (const next of direct.get(id) ?? []) {
      set.add(next);
      for (const deeper of reach(next)) set.add(deeper);
    }
    return set;
  };
  for (const r of rules) reach(r.id);
  return {
    loops: loops.map((group) => group.map((id) => byId.get(id))),
    // Pairs [higher, lower] where the higher rule lists one in a tier above its own; those links are ignored.
    against,
    ranksAbove: (a, b) => below.get(a)?.has(b) ?? false,
  };
}

// Rules `rule` may be set to rank above without making a loop or going against the tiers.
export function eligibleToOutrank(rule, rules) {
  const order = buildOrder(rules);
  const listed = new Set(rule.outranks ?? []);
  return rules.filter((r) => r.id !== rule.id && !listed.has(r.id) && !order.ranksAbove(r.id, rule.id) && tierOf(rule) >= tierOf(r));
}

// Rules `rule` may be set to rank below, which adds it to their lists, on the same terms.
export function eligibleToRankBelow(rule, rules) {
  const order = buildOrder(rules);
  return rules.filter((r) => r.id !== rule.id && !(r.outranks ?? []).includes(rule.id) && !order.ranksAbove(rule.id, r.id) && tierOf(r) >= tierOf(rule));
}

// The built-in ranking, used only between rules that no list relates: the more specific match, then the newer rule.
function builtInBeats(a, b) {
  if (a.score !== b.score) return a.score > b.score;
  const ca = a.rule.createdAt ?? 0;
  const cb = b.rule.createdAt ?? 0;
  if (ca !== cb) return ca > cb;
  // Rules without a creation time rank by position: later in the list counts as newer.
  return a.index > b.index;
}

// Candidates strongest first: at each step the built-in ranking picks from the highest tier left, among those no remaining candidate ranks above.
export function rankCandidates(candidates, order) {
  const left = [...candidates];
  const out = [];
  while (left.length) {
    const tier = Math.max(...left.map((c) => tierOf(c.rule)));
    const open = left.filter((c) => tierOf(c.rule) === tier && !left.some((o) => o !== c && order.ranksAbove(o.rule.id, c.rule.id)));
    const pick = open.reduce((best, c) => (!best || builtInBeats(c, best) ? c : best), null);
    out.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  return out;
}

// Why a matching rule lost to the winner, naming the rule order when a list decided it.
export function lostBecause(loser, winner, candidates, order, formatScore) {
  if (tierOf(winner.rule) > tierOf(loser.rule)) {
    return winner.rule.rankAll === 'above' ? `“${ruleName(winner.rule)}” ranks above all other rules` : 'this rule ranks below all other rules';
  }
  const above = [winner, ...candidates].find((c) => c !== loser && order.ranksAbove(c.rule.id, loser.rule.id));
  if (above) return `ranked below “${ruleName(above.rule)}” by your rule order`;
  if (loser.score !== winner.score) return `less specific (${formatScore(loser.score)} vs ${formatScore(winner.score)})`;
  if ((loser.rule.createdAt ?? 0) !== (winner.rule.createdAt ?? 0)) return 'older rule, equally specific';
  return 'earlier in the list, equally specific';
}
