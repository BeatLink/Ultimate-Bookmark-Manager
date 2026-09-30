// AI folder suggestions: turns bookmarks and folders into text, scores embedding similarity, and proposes new folders.

import { ruleApplies, resolveTarget, keywords, isGroup } from './organize.js';
import { byText } from './text.js';
import { ROOT_IDS } from './tree.js';

export const DEFAULT_AI = {
  sourcePath: '',
  useUrl: true,
  useTitle: true,
  useSummary: false,
  useContent: false,
  useRules: true,
  // Model ids on Hugging Face; Firefox only loads models published by Xenova, Mozilla or onnx-community.
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  summaryModel: 'Xenova/distilbart-cnn-6-6',
  device: 'wasm',
};

export const MODEL_PRESETS = {
  embedding: {
    'Xenova/all-MiniLM-L6-v2': 'MiniLM L6 (small, fast, English)',
    'Xenova/all-MiniLM-L12-v2': 'MiniLM L12 (larger, more accurate, English)',
    'Xenova/paraphrase-multilingual-MiniLM-L12-v2': 'Multilingual MiniLM L12 (50+ languages)',
    'Xenova/bge-small-en-v1.5': 'BGE small (English)',
  },
  summary: {
    'Xenova/distilbart-cnn-6-6': 'DistilBART CNN 6-6 (news-style summaries)',
    'Xenova/distilbart-cnn-12-6': 'DistilBART CNN 12-6 (slower, better)',
    'Xenova/t5-small': 'T5 small (fast, rougher)',
  },
};

// Says what is wrong with a model id, or returns null when Firefox should accept it.
export function modelProblem(id) {
  const value = String(id ?? '').trim();
  if (!value) return 'Enter a model id, e.g. Xenova/all-MiniLM-L6-v2.';
  if (!/^[\w.-]+\/[\w.-]+$/.test(value)) return 'A model id looks like organisation/model-name.';
  if (!/^(Xenova|Mozilla|onnx-community)\//i.test(value)) return 'Firefox only allows models from the Xenova, Mozilla or onnx-community organisations on Hugging Face.';
  return null;
}

// Thresholds measured with Xenova/all-MiniLM-L6-v2 in Firefox: right folders scored 0.22–0.51, wrong ones about 0.15.
const HIGH = 0.35;
const MEDIUM = 0.2;
// Weakly placed bookmarks at least this similar are grouped into a proposed new folder; the same model put two guitar
// pages at 0.31 and unrelated pairs up to 0.29, so only groups averaging CLOSE_GROUP start ticked.
const CLUSTER_AT = 0.3;
const CLOSE_GROUP = 0.45;
// A folder is compared on this many of the bookmarks already in it.
export const MEMBERS_PER_FOLDER = 30;

const STOP = new Set(('a an and are as at be by for from has have how i in is it its of on or that the this to was what when where which who why will with you your ' +
  'www com org net io co uk de html htm php asp aspx index home page pages http https amp utm ref id en us new ' +
  'easy best top free simple quick ultimate complete official online guide tips beginner beginners part vs').split(' '));

// Readable words from an address: host name parts and path segments, without ids, extensions or tracking bits.
export function urlWords(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return '';
  }
  const host = u.hostname.replace(/^www\d*\./, '').split('.').slice(0, -1).join(' ').replaceAll('-', ' ');
  const path = decodeURIComponent(u.pathname).split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !/^\d+$/.test(w) && !/^[0-9a-f]{12,}$/i.test(w) && w.length < 40);
  return [host, ...path].join(' ').trim();
}

// The text that stands for one bookmark, built from the parts the user chose.
export function bookmarkText(bookmark, page, opts) {
  const parts = [];
  if (opts.useTitle) parts.push(page?.title || bookmark.title);
  if (opts.useUrl) parts.push(urlWords(bookmark.url));
  if (opts.useSummary && page?.summary) parts.push(page.summary);
  if (opts.useContent && page) parts.push([page.description, page.headings, page.text].filter(Boolean).join('. '));
  return parts.filter(Boolean).join('. ').replace(/\s+/g, ' ').slice(0, 1500);
}

// Existing bookmarks are compared on name and address only; reading every filed page would be far too slow.
export function memberText(bookmark, opts) {
  return [opts.useTitle || !opts.useUrl ? bookmark.title : '', opts.useUrl ? urlWords(bookmark.url) : ''].filter(Boolean).join('. ');
}

function ruleWords(rule) {
  const walk = (group) => (group.conditions ?? []).flatMap((c) => (isGroup(c) ? (c.match === 'none' ? [] : walk(c)) : c.op === 'regex' ? [] : keywords(c)));
  return rule.match === 'none' ? [] : walk(rule);
}

// Every folder the bookmarks could move to, described by its path and by the keywords of rules that file into it.
// Firefox's top-level folders are left out: they are containers, and would attract whatever fits nowhere else.
export function candidateFolders(flat, root, { sourceId, rules = [], useRules }) {
  const rootFolders = root.children.map((c) => ({ id: c.id, title: c.title }));
  const byPath = new Map();
  const folders = flat
    .filter((n) => n.type === 'folder' && !ROOT_IDS.has(n.id) && n.id !== sourceId)
    .map((n) => ({ id: n.id, path: [...n.path, n.title] }));
  for (const f of folders) byPath.set(f.path.join('/'), f);

  for (const f of folders) {
    f.ruleWords = [];
    f.members = flat.filter((n) => n.type === 'bookmark' && n.parentId === f.id).slice(0, MEMBERS_PER_FOLDER);
  }
  if (useRules) {
    for (const rule of rules) {
      if (rule.enabled === false) continue;
      const target = resolveTarget(rule.target, rootFolders);
      const folder = target && byPath.get(target.path.join('/'));
      if (folder) folder.ruleWords.push(...ruleWords(rule));
    }
  }
  for (const f of folders) {
    f.text = [f.path.slice(1).join(' ') || f.path[0], ...new Set(f.ruleWords)].join('. ');
  }
  return folders;
}

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// Scores every folder for one bookmark: similarity to the folder's name and to the bookmarks already in it; a matching rule wins.
export function scoreFolders(vec, folders, ruleFolderIds = new Set()) {
  const scored = folders.map((f) => {
    const nameSim = dot(vec, f.nameVec);
    const memberSims = f.members.filter((m) => m.vec).map((m) => ({ m, sim: dot(vec, m.vec) })).sort((a, b) => b.sim - a.sim);
    const top = memberSims.slice(0, 3);
    const memberSim = top.length ? top.reduce((s, x) => s + x.sim, 0) / top.length : null;
    let score = memberSim === null ? nameSim * 0.9 : 0.4 * nameSim + 0.6 * memberSim;
    // A matching Organize rule is the user's own instruction, so it decides the folder outright.
    const byRule = ruleFolderIds.has(f.id);
    if (byRule) score += 1;
    return { folder: f, score, nameSim, similar: top.filter((x) => x.sim > 0.3).map((x) => x.m.title), byRule };
  });
  return scored.sort((a, b) => b.score - a.score);
}

export function confidence(best, runnerUp) {
  const margin = best.score - (runnerUp?.score ?? 0);
  if (best.byRule || (best.score >= HIGH && margin >= 0.1)) return 'high';
  if (best.score >= MEDIUM && margin >= 0.04) return 'medium';
  return 'low';
}

export function explain(best) {
  const why = [];
  if (best.byRule) why.push('matches one of your Organize rules');
  if (best.similar.length) why.push(`similar to ${best.similar.slice(0, 2).map((t) => `“${t}”`).join(' and ')}`);
  if (!best.similar.length && best.nameSim >= 0.3) why.push('fits the folder’s name');
  return why.join('; ') || 'closest match';
}

// Groups weakly placed bookmarks that resemble each other, so each group can become a new folder.
export function clusterLeftovers(items, threshold = CLUSTER_AT) {
  const clusters = [];
  for (const item of items) {
    const home = clusters.find((c) => c.members.some((m) => dot(m.vec, item.vec) >= threshold));
    if (home) home.members.push(item);
    else clusters.push({ members: [item] });
  }
  return clusters.filter((c) => c.members.length >= 2);
}

// Names a proposed folder after the word its bookmarks share most, e.g. "Recipes"; a word in both a title and an address counts twice.
export function nameFromWords(texts, taken = new Set()) {
  const counts = new Map();
  for (const text of texts) {
    for (const part of text.toLowerCase().split(/\.\s+/)) {
      const seen = new Set();
      for (const raw of part.split(/[^\p{L}\p{N}]+/u)) {
        if (raw.length < 3 || STOP.has(raw) || /^\d+$/.test(raw) || seen.has(raw)) continue;
        seen.add(raw);
        counts.set(raw, (counts.get(raw) ?? 0) + 1);
      }
    }
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || byText(a[0], b[0]));
  for (const [word] of ranked) {
    const name = word[0].toUpperCase() + word.slice(1);
    if (!taken.has(name.toLowerCase())) return name;
  }
  return 'New folder';
}

// Picks a folder for each bookmark; weak placements that cluster together get a proposed new folder inside the source folder.
export function suggest(bookmarks, folders, { sourcePath, rootFolders = [], rules = [], useRules }) {
  const suggestions = [];
  const weak = [];
  for (const b of bookmarks) {
    const ruleFolderIds = new Set();
    if (useRules) {
      const rule = rules.find((r) => r.enabled !== false && ruleApplies(r, b, rootFolders));
      const path = rule && resolveTarget(rule.target, rootFolders)?.path.join('/');
      const folder = path && folders.find((f) => f.path.join('/') === path);
      if (folder) ruleFolderIds.add(folder.id);
    }
    const [best, runnerUp] = scoreFolders(b.vec, folders, ruleFolderIds);
    if (!best) continue;
    const s = { bookmark: b, path: best.folder.path, isNew: false, score: best.score, confidence: confidence(best, runnerUp), reason: explain(best) };
    suggestions.push(s);
    if (s.confidence === 'low') weak.push({ ...b, suggestion: s });
  }

  const taken = new Set(folders.map((f) => f.path.at(-1).toLowerCase()));
  for (const cluster of clusterLeftovers(weak)) {
    const name = nameFromWords(cluster.members.map((m) => m.text), taken);
    taken.add(name.toLowerCase());
    const sims = cluster.members.flatMap((a, i) => cluster.members.slice(i + 1).map((b) => dot(a.vec, b.vec)));
    const close = sims.reduce((x, y) => x + y, 0) / sims.length >= CLOSE_GROUP;
    for (const m of cluster.members) {
      Object.assign(m.suggestion, {
        path: [...sourcePath, name], isNew: true, confidence: close ? 'medium' : 'low',
        reason: `groups with ${cluster.members.length - 1} other bookmark(s) that fit no existing folder`,
      });
    }
  }
  return suggestions;
}
