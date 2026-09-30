// The "Suggest rules" panel on the Organize page: proposes rules mined from how bookmarks are already filed.

import { h, toast } from './dom.js';
import { pickFolder } from './components.js';
import { mineRules, rescore, proposalToRule } from '../lib/rule-mining.js';
import { planMoves } from '../lib/organize.js';

const PRECISION = { 1: '100% — only terms that never stray', 0.95: '95%', 0.9: '90% (recommended)', 0.8: '80% — more rules, more mistakes' };

// Kept between renders so a refresh does not throw away the proposals or the user's choices.
const panel = { open: false, sourcePath: null, minPrecision: 0.9, proposals: null, skipped: new Set() };

const pathText = (path) => path.join(' › ');
const titles = (list, max = 3) => list.slice(0, max).map((b) => `“${b.title || b.url}”`).join(', ') + (list.length > max ? ` and ${list.length - max} more` : '');

export function openRuleSuggestions() {
  panel.open = true;
}

function sourceParts(ctx) {
  const path = panel.sourcePath ?? ctx.state.settings.ai?.sourcePath ?? '';
  const parts = (path || ctx.state.root.children.find((c) => c.id === 'unfiled_____')?.title || 'Other Bookmarks').split('/').map((s) => s.trim()).filter(Boolean);
  return parts;
}

function find(ctx, rules) {
  panel.proposals = mineRules(ctx.state.flat, {
    sourcePath: sourceParts(ctx),
    existingRules: rules,
    ignoredIds: ctx.ignoredIds(),
    minPrecision: panel.minPrecision,
  });
  panel.skipped.clear();
}

function termChips(ctx, proposal, redraw) {
  const chip = (kind, term) => h('span', { class: 'tag' },
    h('span', { class: 'tag-text', text: kind === 'domain' ? `site: ${term}` : term }),
    h('button', { class: 'tag-remove', text: '×', 'aria-label': `Drop “${term}”`, onclick: () => {
      const next = { ...proposal, domains: proposal.domains.filter((t) => t !== term || kind !== 'domain'), words: proposal.words.filter((t) => t !== term || kind !== 'word') };
      const i = panel.proposals.indexOf(proposal);
      panel.proposals[i] = rescore(ctx.state.flat, next, { sourcePath: sourceParts(ctx), ignoredIds: ctx.ignoredIds() });
      redraw();
    } }));
  return h('div', { class: 'tag-input static' }, proposal.domains.map((t) => chip('domain', t)), proposal.words.map((t) => chip('word', t)));
}

// The panel element; `rules` is the Organize draft, and `onAdd` appends accepted rules to it.
export function ruleSuggestionsPanel(ctx, { rules, onAdd }) {
  const box = h('section', { class: 'rule-suggestions' });
  if (!panel.open) {
    box.hidden = true;
    return box;
  }
  const draw = () => {
    const source = sourceParts(ctx);
    const picker = h('button', { class: 'folder-button', type: 'button', onclick: async () => {
      const picked = await pickFolder(ctx.state.root, source.join('/'));
      if (!picked) return;
      panel.sourcePath = picked;
      panel.proposals = null;
      draw();
    } }, h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), pathText(source));
    const precision = h('select', { 'aria-label': 'Minimum precision', onchange: (e) => { panel.minPrecision = Number(e.target.value); panel.proposals = null; draw(); } },
      Object.entries(PRECISION).sort((a, b) => b[0] - a[0]).map(([v, text]) => h('option', { value: v, text, selected: Number(v) === panel.minPrecision })));

    const header = h('div', { class: 'row wrap' },
      h('h2', { class: 'grow', text: 'Suggested rules' }),
      h('button', { class: 'small', text: 'Close', onclick: () => { panel.open = false; box.hidden = true; } }));
    const controls = h('div', {},
      h('p', { class: 'muted small', text: 'Looks for sites and words that the bookmarks in each of your folders share, and tests each one against everything you have already filed. Accepted rules only look in the unsorted folder, so they never move bookmarks you have already put somewhere.' }),
      h('div', { class: 'row wrap' }, 'Unsorted folder', picker, 'Precision at least', precision,
        h('button', { class: 'primary', text: panel.proposals ? 'Find again' : 'Find rules', onclick: () => { find(ctx, rules); draw(); } })));

    const body = [];
    if (panel.proposals) {
      const list = panel.proposals.filter((p) => p.domains.length || p.words.length);
      if (!list.length) {
        body.push(h('p', { class: 'muted', text: 'No precise rules found. A folder needs at least two bookmarks sharing a site or a distinctive word, and that site or word must rarely appear in other folders.' }));
      } else {
        body.push(h('ul', { class: 'suggestion-list' }, list.map((p) => {
          const key = p.path.join('/');
          const on = !panel.skipped.has(key);
          return h('li', { class: `suggestion${on ? '' : ' off'}` },
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: on, 'aria-label': `Use rule for ${pathText(p.path)}`, onchange: (e) => { e.target.checked ? panel.skipped.delete(key) : panel.skipped.add(key); draw(); } })),
            h('div', { class: 'grow' },
              h('div', { class: 'rule-target', text: `→ ${pathText(p.path)}` }),
              termChips(ctx, p, draw),
              h('p', { class: 'small' },
                h('strong', { class: p.precision >= 0.95 ? 'confidence high' : 'confidence medium', text: `${Math.round(p.precision * 100)}% precise` }),
                ` — ${p.correct} of ${p.hits} filed bookmark(s) these terms match are already in this folder.`),
              p.covers.length
                ? h('p', { class: 'small', text: `Would file ${p.covers.length} unsorted: ${titles(p.covers)}.` })
                : h('p', { class: 'small muted', text: 'Files nothing in the unsorted folder right now, but will catch new bookmarks there.' }),
              p.strays.length > 0 && h('p', { class: 'small muted', text: `Also matches ${titles(p.strays, 2)} in other folders; those stay put.` })));
        })));
        const chosen = list.filter((p) => !panel.skipped.has(p.path.join('/')));
        body.push(h('div', { class: 'row wrap end' },
          h('button', { class: 'primary', text: `Add ${chosen.length} rule(s)`, disabled: !chosen.length, onclick: () => {
            onAdd(chosen.map((p) => proposalToRule(p, source)));
            panel.proposals = null;
            toast(`Added ${chosen.length} rule(s). Review them below, then Save rules.`, 'success');
          } })));
      }
      // How many bookmarks the rules, including these, would still leave in the unsorted folder.
      const withNew = [...rules, ...list.filter((p) => !panel.skipped.has(p.path.join('/'))).map((p) => proposalToRule(p, source))];
      const unsorted = ctx.state.flat.filter((b) => b.type === 'bookmark' && b.path.join('/') === source.join('/'));
      const moved = new Set(planMoves(unsorted, withNew, ctx.state.root.children.map((c) => ({ id: c.id, title: c.title })), ctx.ignoredIds(), ctx.state.flat).moves.map((m) => m.bookmark.id));
      const left = unsorted.filter((b) => !moved.has(b.id)).length;
      if (left) {
        body.push(h('p', { class: 'small muted uncovered', text: `${left} bookmark(s) in ${pathText(source)} would still not be covered by any rule.` }));
      }
    }
    box.replaceChildren(header, controls, ...body);
  };
  draw();
  return box;
}
