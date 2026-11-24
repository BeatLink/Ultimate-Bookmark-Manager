// Plans what the rules would do to each bookmark, running every matching rule's actions from the top of the list down.

import { FOLDER_OPS, valueOf, allConditions, describeAction, folderLabel, folderPaths, folderPathOf, resolveMove, startsWithPath } from './rules.js';
import { matcher } from './matching.js';
import { FIELDS, searchPattern, replaceIn } from './find-replace.js';

// Checks each rule once so the editor can show a problem next to the rule that has it; folders are checked only when `flat` is given.
export function validateRules(rules, rootFolders, flat = null) {
  const problems = new Map();
  const folderNodes = flat?.filter((n) => n.type === 'folder') ?? [];
  const folders = flat && new Set(folderNodes.map((n) => [...n.path, n.title].join('\0')));
  const folderIds = new Set(folderNodes.map((n) => n.id));
  for (const rule of rules) {
    const issues = [];
    const active = allConditions(rule.query).filter(valueOf);
    if (!active.length) issues.push('Add a condition; a rule without one matches nothing.');
    if (!rule.actions.length) issues.push('Add an action.');
    if (folders) {
      for (const c of active.filter((x) => FOLDER_OPS.has(x.operator))) {
        const path = folderPathOf(valueOf(c), rootFolders);
        if (path && !folders.has(path.join('\0'))) issues.push(`The folder “${path.join(' › ')}” no longer exists.`);
      }
    }
    const regexes = active.filter((c) => c.operator === 'matchesRegex').map(valueOf);
    for (const action of rule.actions) {
      const lost = flat && action.folderId && !folderIds.has(action.folderId);
      if (action.type === 'move' && (!action.folderId || lost) && !action.path.trim()) issues.push(lost ? 'The folder to move to no longer exists.' : 'Choose the folder to move to.');
      if (action.type === 'replace' && !action.find) issues.push('Type the text to find and replace.');
      if (action.type === 'replace' && action.find && action.regex) regexes.push(action.find);
    }
    for (const source of regexes) {
      try {
        new RegExp(source);
      } catch (err) {
        issues.push(`Invalid regex “${source}”: ${err.message}`);
      }
    }
    if (issues.length) problems.set(rule.id, issues);
  }
  return problems;
}

// What is already known about bookmarked pages from the last link check: titles it read and where redirects lead, each with the URL it was read from.
export function knownPages(linkResults) {
  const pages = new Map();
  for (const [id, found] of Object.entries(linkResults?.titles ?? {})) pages.set(id, { url: found.url, title: found.title });
  for (const r of linkResults?.results ?? []) {
    if (r.status !== 'redirect') continue;
    const same = pages.get(r.id)?.url === r.url ? pages.get(r.id) : {};
    pages.set(r.id, { ...same, url: r.url, finalUrl: r.finalUrl });
  }
  return pages;
}

// Runs one action on the bookmark's planned state; returns the step to show, or null when the action changes nothing.
function runAction(action, state, bookmark, page, places) {
  const step = (text, extra = {}) => ({ action: action.type, text, ...extra });
  if (action.type === 'move') {
    const target = resolveMove(action, places.folders, places.rootFolders);
    if (!target) return null;
    // A later move overrides an earlier one, and a bookmark already in the folder or below it stays where it is.
    state.target = startsWithPath(bookmark.path, target.path) ? null : target;
    return state.target && step(`Move to “${folderLabel(target.path.join('/'))}”`);
  }
  if (action.type === 'replace') {
    if (!places.patterns.has(action)) places.patterns.set(action, searchPattern(action));
    const pattern = places.patterns.get(action);
    const changed = FIELDS[action.field].filter((field) => {
      const result = replaceIn(state[field] ?? '', pattern, action.replace, action);
      if (result.text === (state[field] ?? '')) return false;
      state[field] = result.text;
      return true;
    });
    return changed.length > 0 && step(describeAction(action));
  }
  if (action.type === 'pageTitle' || action.type === 'redirect') {
    const key = action.type === 'pageTitle' ? 'title' : 'finalUrl';
    const field = action.type === 'pageTitle' ? 'title' : 'url';
    const known = page?.url === bookmark.url ? page : null;
    if (known?.[key]) {
      if (known[key] === state[field]) return null;
      state[field] = known[key];
      return step(action.type === 'pageTitle' ? `Rename to its page title “${known[key]}”` : `Use the address it redirects to`);
    }
    // A page not read yet is read when the plan is applied.
    if (known?.read) return null;
    state.waiting = true;
    return step(action.type === 'pageTitle' ? 'Rename to its page title, read when applied' : 'Use the address it redirects to, if any, read when applied', { waiting: true });
  }
  if (action.type === 'ignore') {
    state.ignore = true;
    return step('Ignore in every check');
  }
  state.remove = true;
  return step('Delete');
}

// Whether a planned change does anything once applied.
export const hasEffect = (change) => change.remove || change.ignore || !!change.target || 'title' in change.edits || 'url' in change.edits;

// Works out what the enabled, valid rules would do to each bookmark; `tree` is the whole tree when `flat` holds only some bookmarks, and `pages` what is known of their pages.
export function planRules(flat, rules, rootFolders, { ignoredIds = new Set(), tree = flat, pages = new Map() } = {}) {
  const problems = validateRules(rules, rootFolders, tree);
  // Each replace action's search is built once per plan rather than once per bookmark.
  const places = { folders: folderPaths(tree), rootFolders, patterns: new Map() };
  // Disabled rules are still matched so the editor can say what they would match; they never act.
  const valid = rules
    .filter((rule) => !problems.has(rule.id))
    .map((rule) => ({ rule, match: matcher(rule, rootFolders), on: rule.enabled !== false }));
  const changes = [];
  const unmatched = [];
  const matches = new Map();
  const acting = new Map();
  const count = (map, id) => map.set(id, (map.get(id) ?? 0) + 1);
  for (const b of flat) {
    if (b.type !== 'bookmark' || ignoredIds.has(b.id)) continue;
    const state = { title: b.title, url: b.url, target: null, remove: false, ignore: false, waiting: false };
    const steps = [];
    let why = null;
    let matched = false;
    for (const u of valid) {
      if (state.remove) break;
      if (u.match.score(b) === null) continue;
      count(matches, u.rule.id);
      if (!u.on) continue;
      matched = true;
      for (const action of u.rule.actions) {
        const step = runAction(action, state, b, pages.get(b.id), places);
        // Only the last move counts, so earlier ones leave the list.
        if (action.type === 'move') steps.splice(0, steps.length, ...steps.filter((s) => s.action !== 'move'));
        if (step) {
          steps.push({ ...step, ruleId: u.rule.id, ruleName: u.rule.name });
          why ??= u.match.explain(b);
        }
        if (state.remove) break;
      }
    }
    if (!matched) {
      unmatched.push(b);
      continue;
    }
    if (!steps.length) continue;
    const edits = {};
    if (!state.remove && state.title !== b.title) edits.title = state.title;
    if (!state.remove && state.url !== b.url) edits.url = state.url;
    const problem = 'url' in edits && !URL.canParse(edits.url) ? 'The new URL is not a valid address' : null;
    for (const id of new Set(steps.map((s) => s.ruleId))) count(acting, id);
    changes.push({
      bookmark: b, steps, edits, why, problem,
      target: state.remove ? null : state.target, remove: state.remove, ignore: state.ignore && !state.remove, waiting: state.waiting,
    });
  }
  return { changes, unmatched, problems, matches, acting };
}
