// AI organizer: suggests a folder for each bookmark in a chosen folder using Firefox's on-device models.

import { h, Selection, toast, confirmDialog } from '../dom.js';
import { viewHeader, emptyState, bindCheckboxes, selectAllToggle, bookmarkInfo, row, pickFolder } from '../components.js';
import { saveSettings } from '../../lib/settings.js';
import { resolveTarget } from '../../lib/organize.js';
import { DEFAULT_AI, MODEL_PRESETS, modelProblem, bookmarkText, memberText, candidateFolders, suggest } from '../../lib/ai-organize.js';
import { fetchPageText } from '../../lib/page-text.js';
import * as ai from '../ai-client.js';

// The running job and its last result survive view switches and refreshes.
const job = { running: false, phase: '', done: 0, total: 0, controller: null, bars: new Set() };
let result = null;
let resumeChecked = false;
// Suggestions the user unticked, and renamed new folders, so a refresh keeps their choices.
const unticked = new Set();
const renamed = new Map();

const CONFIDENCE = { high: 'Good match', medium: 'Likely', low: 'Weak guess' };

function paint() {
  for (const bar of job.bars) {
    if (!bar.isConnected && bar.dataset.painted) {
      job.bars.delete(bar);
      continue;
    }
    bar.dataset.painted = '1';
    bar.hidden = !job.running;
    const p = bar.querySelector('progress');
    if (job.total) {
      p.max = job.total;
      p.value = job.done;
    } else {
      p.removeAttribute('value');
    }
    bar.querySelector('span').textContent = job.total ? `${job.phase}: ${job.done} of ${job.total}` : `${job.phase}…`;
  }
}

function step(phase, total = 0) {
  Object.assign(job, { phase, total, done: 0 });
  paint();
}

function tick(done) {
  job.done = done;
  paint();
}

const aiSettings = (ctx) => ({ ...DEFAULT_AI, ...(ctx.state.settings.ai ?? {}) });

function findFolderId(ctx, path) {
  const target = resolveTarget(path, ctx.state.root.children.map((c) => ({ id: c.id, title: c.title })));
  if (!target) return null;
  if (!target.segments.length) return target.rootId;
  const joined = target.path.join('/');
  return ctx.state.flat.find((n) => n.type === 'folder' && [...n.path, n.title].join('/') === joined)?.id ?? null;
}

// Starts a run. From a click it may ask for website access; when resuming after a restart it only checks it.
function run(ctx, { resume = false } = {}) {
  if (job.running) return;
  const opts = aiSettings(ctx);
  const needPages = opts.useContent || opts.useSummary;
  const sites = { origins: ['<all_urls>'] };
  const access = !needPages ? Promise.resolve(true) : resume ? browser.permissions.contains(sites) : browser.permissions.request(sites);
  access.then(async (granted) => {
    if (!granted) return toast('Reading pages needs permission to access websites.', 'error');
    Object.assign(job, { running: true, controller: new AbortController() });
    const signal = job.controller.signal;
    try {
      result = await suggestFolders(ctx, opts, signal);
      unticked.clear();
      renamed.clear();
      for (const s of result.suggestions) if (s.confidence === 'low') unticked.add(s.bookmark.id);
      toast(`Suggested folders for ${result.suggestions.length} bookmark(s).`, 'success');
    } catch (err) {
      if (err instanceof ai.ModelSwitchError) return offerRestart(err);
      if (!signal.aborted) {
        console.error(err);
        toast(`AI organizer failed: ${err.message ?? err}`, 'error');
      }
    } finally {
      job.running = false;
      paint();
      ctx.render();
    }
  });
}

// Firefox keeps one model per add-on session, so a different model means restarting the add-on and resuming.
async function offerRestart(err) {
  const next = err.wanted.task === 'summarization' ? 'the summary model' : 'the embedding model';
  const ok = await confirmDialog(`${err.message} To load ${next}, the add-on has to restart. This page will reopen and carry on; summaries made so far are kept.`, 'Restart and continue', false);
  if (!ok) return;
  await browser.storage.local.set({ aiResume: Date.now() });
  browser.runtime.reload();
}

async function loadSummaries() {
  const { aiSummaries } = await browser.storage.local.get('aiSummaries');
  return aiSummaries ?? {};
}

async function suggestFolders(ctx, opts, signal) {
  const sourceId = findFolderId(ctx, opts.sourcePath);
  if (!sourceId) throw new Error('Choose a folder to organize first.');
  const ignored = ctx.ignoredIds();
  const bookmarks = ctx.state.flat.filter((b) => b.type === 'bookmark' && b.parentId === sourceId && !ignored.has(b.id));
  if (!bookmarks.length) throw new Error('That folder has no bookmarks directly inside it.');
  const checkCancel = () => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };

  // 1. Read pages, when their content or a summary is wanted.
  const pages = new Map();
  if (opts.useContent || opts.useSummary) {
    step('Reading pages', bookmarks.length);
    let next = 0;
    let read = 0;
    const worker = async () => {
      while (next < bookmarks.length && !signal.aborted) {
        const b = bookmarks[next++];
        const page = await fetchPageText(b.url, { timeout: ctx.state.settings.linkCheck.timeoutSeconds * 1000, signal }).catch(() => ({ error: 'Cancelled' }));
        if (!page.error) pages.set(b.id, page);
        tick(++read);
      }
    };
    await Promise.all(Array.from({ length: ctx.state.settings.linkCheck.concurrency }, worker));
    checkCancel();
  }

  // 2. Summaries, one model run per page; saved per address and model so a page is only ever summarized once.
  if (opts.useSummary && pages.size) {
    const saved = await loadSummaries();
    const todo = [];
    for (const [id, page] of pages) {
      const url = bookmarks.find((b) => b.id === id).url;
      const hit = saved[url];
      if (hit?.model === opts.summaryModel) page.summary = hit.summary;
      else todo.push({ id, url, page });
    }
    if (todo.length) {
      step('Loading summary model');
      const texts = todo.map(({ page: p }) => [p.title, p.description, p.headings, p.text].filter(Boolean).join('. ').slice(0, 3000));
      const summaries = await ai.summarize(texts, {
        model: opts.summaryModel, device: opts.device, signal,
        onModel: (m) => { job.phase = m; paint(); },
        onItem: (i) => {
          if (i === 0) step('Summarizing pages', texts.length);
          tick(i + 1);
        },
      });
      todo.forEach(({ url, page }, i) => {
        page.summary = summaries[i];
        saved[url] = { model: opts.summaryModel, summary: summaries[i] };
      });
      await browser.storage.local.set({ aiSummaries: saved });
    }
    checkCancel();
  }

  // 3. Embeddings for the bookmarks, the folders and the bookmarks already in each folder.
  const folders = candidateFolders(ctx.state.flat, ctx.state.root, { sourceId, rules: ctx.state.settings.organize.rules, useRules: opts.useRules });
  const items = bookmarks.map((b) => ({ ...b, text: bookmarkText(b, pages.get(b.id), opts) || b.title || b.url }));
  const members = folders.flatMap((f) => f.members);
  const texts = [...items.map((b) => b.text), ...folders.map((f) => f.text), ...members.map((m) => memberText(m, opts) || m.title)];
  step('Loading embedding model');
  const vectors = await ai.embed(texts, {
    model: opts.embeddingModel, device: opts.device, signal,
    onModel: (m) => { job.phase = m; paint(); },
    onItem: (done) => { if (job.phase !== 'Comparing bookmarks and folders') step('Comparing bookmarks and folders', texts.length); tick(done); },
  });
  checkCancel();
  let i = 0;
  for (const b of items) b.vec = vectors[i++];
  for (const f of folders) f.nameVec = vectors[i++];
  for (const m of members) m.vec = vectors[i++];

  // 4. Pick a folder for each bookmark.
  const sourcePath = opts.sourcePath.split('/').map((s) => s.trim()).filter(Boolean);
  const resolved = resolveTarget(opts.sourcePath, ctx.state.root.children.map((c) => ({ id: c.id, title: c.title })));
  const rootFolders = ctx.state.root.children.map((c) => ({ id: c.id, title: c.title }));
  return { sourceId, time: Date.now(), suggestions: suggest(items, folders, { sourcePath: resolved?.path ?? sourcePath, rootFolders, rules: ctx.state.settings.organize.rules, useRules: opts.useRules }) };
}

function modelPicker(label, kind, value, onchange) {
  const presets = MODEL_PRESETS[kind];
  const isCustom = !(value in presets);
  const custom = h('input', { type: 'text', class: 'mono', value: isCustom ? value : '', placeholder: 'Xenova/model-name', 'aria-label': `Custom ${label.toLowerCase()}`, hidden: !isCustom });
  const problem = h('p', { class: 'error small', hidden: true });
  const check = () => {
    const msg = modelProblem(custom.value);
    problem.textContent = msg ?? '';
    problem.hidden = !msg;
    return !msg;
  };
  const choose = h('select', { 'aria-label': label, onchange: () => {
    custom.hidden = choose.value !== 'custom';
    if (choose.value !== 'custom') onchange(choose.value);
    else custom.focus();
  } }, Object.entries(presets).map(([id, text]) => h('option', { value: id, text, selected: id === value })),
  h('option', { value: 'custom', text: 'Custom model…', selected: isCustom }));
  custom.addEventListener('change', () => check() && onchange(custom.value.trim()));
  if (isCustom) check();
  return h('label', { class: 'field block' }, label, h('div', { class: 'row wrap' }, choose, custom), problem);
}

function options(ctx) {
  const opts = aiSettings(ctx);
  const save = (patch) => ctx.run(() => saveSettings({ ...ctx.state.settings, ai: { ...opts, ...patch } }));
  const check = (key, label, hint) => h('label', { class: 'check-line' },
    h('input', { type: 'checkbox', checked: opts[key], onchange: (e) => {
      const next = { ...opts, [key]: e.target.checked };
      if (!next.useUrl && !next.useTitle && !next.useSummary && !next.useContent) {
        e.target.checked = true;
        return toast('Keep at least one of address, title, summary or content ticked.', 'error');
      }
      save({ [key]: e.target.checked });
    } }), h('span', {}, label, hint && h('span', { class: 'muted small', text: ` — ${hint}` })));

  const source = h('button', { class: `folder-button${opts.sourcePath ? '' : ' unset'}`, type: 'button', onclick: async () => {
    const picked = await pickFolder(ctx.state.root, opts.sourcePath);
    if (picked) save({ sourcePath: picked });
  } }, h('span', { class: 'folder-icon', 'aria-hidden': 'true' }), opts.sourcePath ? opts.sourcePath.split('/').join(' › ') : 'Choose folder…');

  return h('div', {},
    h('fieldset', {}, h('legend', { text: 'What to organize' }),
      h('div', { class: 'row wrap' }, 'Suggest new places for the bookmarks directly inside', source)),
    h('fieldset', {}, h('legend', { text: 'What the AI looks at' }),
      check('useUrl', 'Address', 'domain and path words'),
      check('useTitle', 'Page title', 'the bookmark’s name, or the page’s own title when pages are read'),
      check('useSummary', 'AI summary of the page', 'reads each page and summarizes it on your device; slowest'),
      check('useContent', 'Page content', 'description, headings and opening text of each page'),
      check('useRules', 'Use my Organize rules', 'a matching rule decides the folder, and rule keywords describe folders')),
    h('fieldset', {}, h('legend', { text: 'Models' }),
      modelPicker('Embedding model', 'embedding', opts.embeddingModel, (v) => save({ embeddingModel: v })),
      opts.useSummary && modelPicker('Summary model', 'summary', opts.summaryModel, (v) => save({ summaryModel: v })),
      h('label', { class: 'field' }, 'Run on',
        h('select', { onchange: (e) => save({ device: e.target.value }) },
          h('option', { value: 'wasm', text: 'CPU', selected: opts.device !== 'gpu' }),
          h('option', { value: 'gpu', text: 'GPU (faster where supported)', selected: opts.device === 'gpu' }))),
      h('p', { class: 'muted small', text: 'Models download once from Hugging Face and are kept by Firefox. Everything runs on this device; nothing is sent to an AI service.' }),
      h('button', { class: 'small', text: 'Delete downloaded models', onclick: async () => {
        if (!(await confirmDialog('Delete the models Firefox downloaded for this add-on? They download again next time.', 'Delete'))) return;
        ctx.run(async () => { await ai.deleteModels(); toast('Downloaded models deleted.', 'success'); });
      } })));
}

function results(ctx) {
  if (!result) return null;
  const inSource = new Set(ctx.state.flat.filter((b) => b.parentId === result.sourceId).map((b) => b.id));
  const current = result.suggestions.filter((s) => inSource.has(s.bookmark.id));
  if (!current.length) return emptyState('Every suggested bookmark has been moved.');

  const sel = new Selection();
  sel.set(current.map((s) => s.bookmark.id).filter((id) => !unticked.has(id)), true);
  sel.onChange(() => { for (const s of current) sel.has(s.bookmark.id) ? unticked.delete(s.bookmark.id) : unticked.add(s.bookmark.id); });

  const pathOf = (s) => (s.isNew ? [...s.path.slice(0, -1), renamed.get(s.path.join('/')) ?? s.path.at(-1)] : s.path);
  const groups = new Map();
  for (const s of current) {
    const key = s.path.join('/');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const rootFolders = ctx.state.root.children.map((c) => ({ id: c.id, title: c.title }));
  const apply = h('button', { class: 'primary', onclick: async () => {
    const chosen = current.filter((s) => sel.has(s.bookmark.id));
    const created = new Set(chosen.filter((s) => s.isNew).map((s) => pathOf(s).join(' › ')));
    if (!(await confirmDialog(`Move ${chosen.length} bookmark(s)?${created.size ? ` New folder(s): ${[...created].join(', ')}.` : ''} You can undo this from the history.`, 'Move', false))) return;
    await ctx.run(async () => {
      await ctx.actions.organize(chosen.map((s) => ({ id: s.bookmark.id, target: resolveTarget(pathOf(s).join('/'), rootFolders) })), `AI organized ${chosen.length} bookmark(s)`);
      ctx.done(`Moved ${chosen.length} bookmark(s).`);
    });
  } });
  const update = () => { apply.textContent = `Move ${sel.size} selected`; apply.disabled = !sel.size; };
  sel.onChange(update);
  update();

  const list = h('div', { class: 'groups' }, [...groups].sort((a, b) => b[1].length - a[1].length).map(([key, group]) => {
    const first = group[0];
    const title = first.isNew
      ? h('span', { class: 'row wrap' }, '→ ', first.path.slice(0, -1).join(' › '), ' › ',
        h('input', { type: 'text', class: 'new-folder-name', value: renamed.get(key) ?? first.path.at(-1), 'aria-label': 'New folder name',
          onchange: (e) => { const v = e.target.value.trim().replaceAll('/', ''); if (v) renamed.set(key, v); } }),
        h('span', { class: 'rule-badge active', text: 'new folder' }), ` — ${group.length}`)
      : h('span', { text: `→ ${key.split('/').join(' › ')} — ${group.length}` });
    return h('section', { class: 'group' },
      h('h2', { class: 'group-title sticky' }, title, selectAllToggle(sel, group.map((s) => s.bookmark.id), 'Select group')),
      h('ul', { class: 'items' }, group.map((s) => row(sel, s.bookmark.id, bookmarkInfo(s.bookmark, ctx, {
        editable: false,
        meta: [h('span', { class: `confidence ${s.confidence}`, text: CONFIDENCE[s.confidence] }), h('span', { text: s.reason })],
      })))));
  }));
  bindCheckboxes(list, sel);
  return h('div', {},
    h('div', { class: 'selection-bar' },
      h('div', { class: 'row wrap' }, h('h2', { text: `Suggestions for ${current.length} bookmark(s)` })),
      h('div', { class: 'row wrap end' }, selectAllToggle(sel, current.map((s) => s.bookmark.id)), apply)),
    h('p', { class: 'muted small', text: 'Weak guesses start unticked. Rename a proposed new folder before moving; it is only created when you move bookmarks into it.' }),
    list);
}

export default {
  id: 'ai',
  label: 'AI organizer',

  render(ctx) {
    const status = h('div', { class: 'ai-status' }, h('p', { class: 'muted', text: 'Checking on-device AI…' }));
    ai.status().then((s) => {
      if (s.ok) return status.replaceChildren();
      status.replaceChildren(h('div', { class: 'notice' },
        h('p', { text: s.message }),
        s.needsPermission
          ? h('button', { class: 'primary', text: 'Allow on-device AI', onclick: () => ai.requestPermission().then((ok) => ok && location.reload()) })
          : h('button', { text: 'Reload page', onclick: () => location.reload() })));
    });
    // After a restart for a different model, carry on with the run that asked for it.
    if (!resumeChecked) {
      resumeChecked = true;
      browser.storage.local.get('aiResume').then(({ aiResume }) => {
        if (!aiResume || Date.now() - aiResume > 5 * 60 * 1000) return;
        browser.storage.local.remove('aiResume');
        run(ctx, { resume: true });
      });
    }

    const progress = h('div', { class: 'progress', hidden: true },
      h('progress', {}), h('span', { class: 'muted' }),
      h('button', { class: 'small', text: 'Cancel', onclick: () => job.controller?.abort() }));
    job.bars.add(progress);
    paint();

    return h('section', { class: 'ai' },
      viewHeader('AI organizer', 'Suggests a folder for each bookmark using an AI model that runs on your device. Nothing moves until you review the suggestions and choose Move.',
        h('button', { class: 'primary', text: result ? 'Suggest again' : 'Suggest folders', disabled: job.running, onclick: () => run(ctx) })),
      status,
      progress,
      results(ctx),
      options(ctx));
  },
};
