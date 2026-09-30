// Rule suggestions: finds domains and words that the bookmarks in one folder share, keeps the ones that are
// precise when tested against everything already filed, and turns each folder's survivors into one Organize rule.

import { ROOT_IDS } from './tree.js';
import { ruleMatches, newCondition } from './organize.js';
import { byText } from './text.js';

// Words too common or too generic to say which folder a bookmark belongs in.
const STOP = new Set(('a an and are as at be by for from has have how in is it its of on or that the this to was what when where which who why will with you your ' +
  'www com org net io co uk de html htm php asp aspx index home page pages http https amp utm ref id en us new ' +
  'easy best top free simple quick ultimate complete official online guide tips part vs get use using about all more one two').split(' '));

// Second-level labels that belong to the country ending, so "bbc.co.uk" keeps three labels.
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ne', 'or']);

export const DEFAULT_MINING = { minPrecision: 0.9, minSupport: 2 };

// The part of a host a person would call the site: "docs.python.org" gives "python.org".
export function siteDomain(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || /^[\d.]+$/.test(host) || !host.includes('.')) return null;
  const labels = host.split('.');
  const keep = labels.length >= 3 && labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2)) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

// Distinctive words from a bookmark's title and address path; the host is left to the domain rules.
export function wordsOf(bookmark) {
  let path = '';
  try {
    path = decodeURIComponent(new URL(bookmark.url).pathname);
  } catch {
    // Not a parseable address: use the title alone.
  }
  const words = new Set();
  for (const raw of `${bookmark.title ?? ''} ${path}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length >= 3 && raw.length <= 30 && !STOP.has(raw) && !/^\d+$/.test(raw) && !/^[0-9a-f]{8,}$/.test(raw)) words.add(raw);
  }
  return words;
}

function isInside(path, prefix) {
  return prefix.length <= path.length && prefix.every((seg, i) => path[i] === seg);
}

function buildRule(folderPath, domains, words) {
  const conditions = [];
  if (domains.length) conditions.push({ ...newCondition(), op: 'domain', values: [...domains].sort(byText) });
  if (words.length) conditions.push({ ...newCondition(), field: 'either', op: 'contains', values: [...words].sort(byText) });
  return { match: 'any', conditions, target: folderPath.join('/') };
}

// How a rule scores against bookmarks already filed: how many it matches, and how many of those already sit in its folder.
function evaluate(rule, folderPath, filed) {
  let hits = 0;
  let correct = 0;
  const strays = [];
  for (const b of filed) {
    if (!ruleMatches(rule, b)) continue;
    hits++;
    if (isInside(b.path, folderPath)) correct++;
    else strays.push(b);
  }
  return { hits, correct, precision: hits ? correct / hits : 0, strays };
}

// Proposes one rule per folder from what its bookmarks share, tested for precision against every filed bookmark.
// `sourcePath` is the unsorted folder: it is not mined, it is what the rules are measured on, and the rules only look there.
export function mineRules(flat, { sourcePath, existingRules = [], ignoredIds = new Set(), minPrecision = DEFAULT_MINING.minPrecision, minSupport = DEFAULT_MINING.minSupport } = {}) {
  const inSource = (b) => isInside(b.path, sourcePath);
  const bookmarks = flat.filter((b) => b.type === 'bookmark' && !ignoredIds.has(b.id));
  const filed = bookmarks.filter((b) => !inSource(b));
  const unsorted = bookmarks.filter(inSource);

  // Terms an existing rule already files into a folder need not be proposed again.
  const covered = new Map();
  for (const rule of existingRules) {
    const key = rule.target;
    const terms = covered.get(key) ?? new Set();
    const walk = (g) => (g.conditions ?? []).forEach((c) => (c.type === 'group' ? walk(c) : (c.values ?? []).forEach((v) => terms.add(v.toLowerCase()))));
    walk(rule);
    covered.set(key, terms);
  }

  const folders = flat.filter((n) => n.type === 'folder' && !ROOT_IDS.has(n.id));
  const proposals = [];
  for (const folder of folders) {
    const folderPath = [...folder.path, folder.title];
    if (isInside(folderPath, sourcePath) || isInside(sourcePath, folderPath)) continue;
    const members = filed.filter((b) => b.parentId === folder.id);
    if (members.length < minSupport) continue;

    // Count how many of the folder's own bookmarks share each domain and word.
    const domainCount = new Map();
    const wordCount = new Map();
    for (const b of members) {
      const d = siteDomain(b.url);
      if (d) domainCount.set(d, (domainCount.get(d) ?? 0) + 1);
      for (const w of wordsOf(b)) wordCount.set(w, (wordCount.get(w) ?? 0) + 1);
    }
    const already = covered.get(folderPath.join('/')) ?? new Set();
    const candidates = [
      ...[...domainCount].map(([term, n]) => ({ kind: 'domain', term, n })),
      ...[...wordCount].map(([term, n]) => ({ kind: 'word', term, n })),
    ].filter((c) => c.n >= minSupport && !already.has(c.term));

    // Test each term alone, then add the precise ones to the folder's rule while it stays precise.
    const scored = candidates
      .map((c) => ({ ...c, ...evaluate(buildRule(folderPath, c.kind === 'domain' ? [c.term] : [], c.kind === 'word' ? [c.term] : []), folderPath, filed) }))
      .filter((c) => c.precision >= minPrecision && c.correct >= minSupport)
      .sort((a, b) => b.correct - a.correct || b.precision - a.precision || byText(a.term, b.term));
    const domains = [];
    const words = [];
    let result = null;
    for (const c of scored) {
      // Keywords match anywhere in the text, so "recipes" adds nothing once "recipe" is in the rule.
      if (c.kind === 'word' && words.some((w) => c.term.includes(w))) continue;
      const tryDomains = c.kind === 'domain' ? [...domains, c.term] : domains;
      // A shorter word replaces longer ones it is part of, since it already matches everything they do.
      const tryWords = c.kind === 'word' ? [...words.filter((w) => !w.includes(c.term)), c.term] : words;
      const trial = evaluate(buildRule(folderPath, tryDomains, tryWords), folderPath, filed);
      if (trial.precision < minPrecision) continue;
      domains.splice(0, domains.length, ...tryDomains);
      words.splice(0, words.length, ...tryWords);
      result = trial;
    }
    if (!result) continue;

    const rule = buildRule(folderPath, domains, words);
    const covers = unsorted.filter((b) => ruleMatches(rule, b));
    proposals.push({ folderId: folder.id, path: folderPath, domains, words, ...result, covers, rule });
  }

  // A term proposed for both a folder and one inside it belongs to the inner folder, which is the more specific home.
  for (const p of proposals) {
    const inner = proposals.filter((q) => q !== p && isInside(q.path, p.path) && q.path.length > p.path.length);
    if (!inner.length) continue;
    const taken = new Set(inner.flatMap((q) => [...q.domains, ...q.words]));
    p.domains = p.domains.filter((t) => !taken.has(t));
    p.words = p.words.filter((t) => !taken.has(t));
    p.rule = buildRule(p.path, p.domains, p.words);
    Object.assign(p, evaluate(p.rule, p.path, filed));
    p.covers = unsorted.filter((b) => ruleMatches(p.rule, b));
  }

  // Most useful first: rules that file the most unsorted bookmarks, then the most precise.
  return proposals
    .filter((p) => p.domains.length || p.words.length)
    .sort((a, b) => b.covers.length - a.covers.length || b.precision - a.precision || byText(a.path.join('/'), b.path.join('/')));
}

// Turns an accepted proposal into an Organize rule that only looks in the unsorted folder.
export function proposalToRule(proposal, sourcePath) {
  return {
    ...proposal.rule,
    id: crypto.randomUUID(),
    name: `Suggested: ${proposal.path.at(-1)}`,
    enabled: true,
    sources: [sourcePath.join('/')],
    sourceSubfolders: false,
  };
}

// Re-scores a proposal after the user removes some of its terms.
export function rescore(flat, proposal, { sourcePath, ignoredIds = new Set() }) {
  const bookmarks = flat.filter((b) => b.type === 'bookmark' && !ignoredIds.has(b.id));
  const filed = bookmarks.filter((b) => !isInside(b.path, sourcePath));
  const rule = buildRule(proposal.path, proposal.domains, proposal.words);
  const covers = proposal.domains.length || proposal.words.length ? bookmarks.filter((b) => isInside(b.path, sourcePath) && ruleMatches(rule, b)) : [];
  return { ...proposal, rule, covers, ...evaluate(rule, proposal.path, filed) };
}
