// The order users set between rules: each rule lists the rules it ranks above. When two matching rules are related
// by these lists (directly or through others), the list decides; only unrelated rules fall back to the built-in ranking.

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

// Everything each rule ranks above, following the lists through other rules; links inside a loop are left out.
export function buildOrder(rules) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const loops = loopGroups(rules, byId);
  const loopOf = new Map();
  loops.forEach((group, i) => group.forEach((id) => loopOf.set(id, i)));
  const direct = new Map(rules.map((r) => [r.id, (r.outranks ?? []).filter((id) => byId.has(id) && id !== r.id && !(loopOf.has(r.id) && loopOf.get(r.id) === loopOf.get(id)))]));
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
    ranksAbove: (a, b) => below.get(a)?.has(b) ?? false,
  };
}

// Rules that may be added to `rule`'s list without making a loop: not itself, not already listed, and not ranked above it.
export function eligibleToOutrank(rule, rules) {
  const order = buildOrder(rules);
  const listed = new Set(rule.outranks ?? []);
  return rules.filter((r) => r.id !== rule.id && !listed.has(r.id) && !order.ranksAbove(r.id, rule.id));
}

// The built-in ranking, used only between rules that no list relates: a rule with conditions over a catch-all,
// then the more specific match, then the newer rule.
export function builtInBeats(a, b) {
  const ta = a.rule.catchAll ? 0 : 1;
  const tb = b.rule.catchAll ? 0 : 1;
  if (ta !== tb) return ta > tb;
  if (a.score !== b.score) return a.score > b.score;
  const ca = a.rule.createdAt ?? 0;
  const cb = b.rule.createdAt ?? 0;
  if (ca !== cb) return ca > cb;
  // Rules saved before creation times were recorded: later in the list counts as newer.
  return a.index > b.index;
}

// Candidates strongest first: at each step, of those no remaining candidate ranks above, the built-in ranking picks one.
export function rankCandidates(candidates, order) {
  const left = [...candidates];
  const out = [];
  while (left.length) {
    const open = left.filter((c) => !left.some((o) => o !== c && order.ranksAbove(o.rule.id, c.rule.id)));
    const pick = open.reduce((best, c) => (!best || builtInBeats(c, best) ? c : best), null);
    out.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  return out;
}

// Why a matching rule lost to the winner, naming the rule order when a list decided it.
export function lostBecause(loser, winner, candidates, order, formatScore) {
  const above = [winner, ...candidates].find((c) => c !== loser && order.ranksAbove(c.rule.id, loser.rule.id));
  if (above) return `ranked below “${above.rule.name || 'Unnamed rule'}” by your rule order`;
  if (loser.rule.catchAll && !winner.rule.catchAll) return 'catch-alls only take what no other rule matches';
  if (loser.score !== winner.score) return `less specific (${formatScore(loser.score)} vs ${formatScore(winner.score)})`;
  if ((loser.rule.createdAt ?? 0) !== (winner.rule.createdAt ?? 0)) return 'older rule, equally specific';
  return 'earlier in the list, equally specific';
}

// Drops the retired priority numbers and fallback flags from saved rules; ranking lists replace both.
export function dropRetiredRanking(rules) {
  return rules.map((rule) => {
    if (!('priority' in rule) && !('fallback' in rule)) return rule;
    const { priority, fallback, ...rest } = rule;
    return rest;
  });
}
