// Each bookmark's video length, kept in storage.local, and the commands that find lengths for the selection and write them into names.

import { toast } from '../../dom.js';
import { isBookmark } from '../../../lib/tree.js';
import { checkTargets, fetchOptions } from '../../../lib/linkcheck.js';
import { loadLengths, loadPageLengths, worthOpening, mergeLengths, lengthFor, NO_LENGTH, hasLengthInName, nameWithLength, nameWithoutLength } from '../../../lib/video-lengths.js';
import { loadVideoLengths, saveVideoLengths } from '../../../lib/settings.js';
import { formatLength } from '../../../lib/html-video.js';
import { ProgressJob } from '../../progress.js';
import { askAllSites, askToOpenPages } from '../../permissions.js';
import { view, saveColumns } from './state.js';

// `at` changes whenever the saved lengths do, so the details pane knows to redraw.
export const lengths = { saved: null, at: 0, loading: null };
// Why the last search found no length for a bookmark.
export const failures = new Map();

// The running search, kept here so switching views does not lose it; `step` names what it is doing now.
const search = { step: 'Finding video lengths' };
export const job = new ProgressJob((done, total) => `${search.step}: ${done} of ${total}`);

export const lengthOf = (node) => lengthFor(lengths.saved, node);

// What the details pane says about a bookmark's video length, or null when there is nothing to say.
export function lengthNote(node) {
  const seconds = lengthOf(node);
  if (seconds) return `Video ${formatLength(seconds)}`;
  const why = failures.get(node.id);
  if (!why) return null;
  return why === NO_LENGTH ? why : `No video length: ${why}`;
}

const keep = (saved) => {
  lengths.saved = saved;
  lengths.at = Date.now();
};

export function loadSavedLengths() {
  lengths.loading ??= loadVideoLengths()
    .catch(() => ({}))
    .then(keep)
    .finally(() => { lengths.loading = null; });
  return lengths.loading;
}

// Lengths found in another window, such as the sidebar, show here on the next render.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'videoLengths' in changes) keep(changes.videoLengths.newValue ?? {});
});

export function lengthsOf(lib) {
  const { ctx, get } = lib;

  // The selected bookmarks and every bookmark inside the selected folders.
  const bookmarksIn = (ids) => {
    const found = new Map();
    const collect = (n) => {
      if (isBookmark(n)) found.set(n.id, n);
      n.children?.forEach(collect);
    };
    ids.map(get).filter(Boolean).forEach(collect);
    return [...found.values()];
  };

  // Turns the column on the first time a search finds a length.
  const showColumn = () => {
    if (view.columns.length) return;
    view.columns.length = true;
    saveColumns();
  };

  // Shows and saves each length as soon as it is found, so a long search fills the column as it goes.
  const liveLengths = () => {
    const found = {};
    let redraw = null;
    const live = {
      saving: Promise.resolve(),
      add: (b, r) => {
        if (!r.seconds) return;
        found[b.id] = { url: b.url, seconds: r.seconds };
        // Every write carries everything found so far, so a late storage event cannot drop an earlier find.
        keep({ ...lengths.saved, ...found });
        live.saving = live.saving.then(() => saveVideoLengths({ ...lengths.saved, ...found })).catch(() => {});
        showColumn();
        redraw ??= setTimeout(() => {
          redraw = null;
          ctx.render();
        }, 300);
      },
    };
    return live;
  };

  // Opens the pages whose HTML named no length in a hidden window and reads their videos, updating `results` in place.
  const openPages = async (targets, results, signal, onResult) => {
    const misses = targets.filter((b) => worthOpening(results.get(b.id)));
    if (!misses.length || signal.aborted) return;
    search.step = 'Opening pages to find video lengths';
    job.total = misses.length;
    job.progress(0);
    const opened = await loadPageLengths(misses, { signal, onResult, onProgress: (done) => job.progress(done) });
    for (const [id, r] of opened) {
      // A failure the HTML read already explained, such as a missing page, says more than the opened page does.
      if (r.seconds || results.get(id).error === NO_LENGTH) results.set(id, r);
    }
  };

  // Finds the length of each selected bookmark and of every bookmark inside the selected folders; with `fullPages`, pages whose HTML names none are then opened in a hidden window. Straight from the click, so Firefox may ask for permission.
  const findLengths = (ids, { fullPages = false } = {}) => {
    if (job.running) return toast('Video lengths are already being found.');
    const wanted = new Set(bookmarksIn(ids).map((b) => b.id));
    const { targets, skipped } = checkTargets(ctx.state.flat, ctx.state.settings.linkCheck, new Set(), wanted);
    if (!targets.length) {
      return toast(skipped ? 'The link check skips every selected page, so it has no length to find.' : 'Select bookmarks or folders to find video lengths for.', 'error');
    }
    (fullPages ? askToOpenPages() : askAllSites()).then(async (granted) => {
      if (!granted) return toast(fullPages ? 'Opening pages to find video lengths needs permission to access websites and run scripts in them.' : 'Finding video lengths needs permission to access websites.', 'error');
      if (!lengths.saved) await loadSavedLengths();
      const live = liveLengths();
      const signal = job.start(targets.length);
      let results;
      try {
        results = await loadLengths(targets, { ...fetchOptions(ctx.state.settings.linkCheck), signal, onResult: live.add, onProgress: (done) => job.progress(done) });
        if (fullPages) await openPages(targets, results, signal, live.add);
      } catch (err) {
        return toast(`Could not load pages: ${err.message ?? err}`, 'error');
      } finally {
        search.step = 'Finding video lengths';
        job.finish();
      }
      for (const b of targets) failures.delete(b.id);
      for (const [id, r] of results) if (r.error) failures.set(id, r.error);
      await live.saving;
      keep(mergeLengths(lengths.saved, targets, results, new Set(ctx.state.flat.map((b) => b.id))));
      try {
        await saveVideoLengths(lengths.saved);
      } catch (err) {
        toast(`Could not save the video lengths: ${err.message ?? err}`, 'error');
      }
      showColumn();
      ctx.render();
      const found = [...results.values()].filter((r) => r.seconds).length;
      const missed = results.size - found;
      const message = `Found the video length of ${found} of ${targets.length} page(s).`
        + (missed ? ` ${missed} had none; select one to see why.` : '')
        + (skipped ? ` ${skipped} skipped by the link check’s settings.` : '');
      toast(message, found ? 'success' : 'error');
    });
  };

  // What adding or removing the length would rename, as { id, title } changes.
  const namesWithLength = (ids) => bookmarksIn(ids).filter((b) => lengthOf(b)).map((b) => ({ id: b.id, title: nameWithLength(b.title, lengthOf(b)) })).filter((c) => c.title !== get(c.id).title);
  const namesWithoutLength = (ids) => bookmarksIn(ids).filter((b) => hasLengthInName(b.title)).map((b) => ({ id: b.id, title: nameWithoutLength(b.title) }));

  // Renames the bookmarks as one step that can be undone.
  const rename = (changes, label) => ctx.run(async () => {
    await ctx.actions.update(changes, label);
    ctx.done(`${label}.`);
  });
  const addLengthToNames = (ids) => {
    const changes = namesWithLength(ids);
    if (changes.length) rename(changes, `Added the video length to ${changes.length} name(s)`);
  };
  const removeLengthFromNames = (ids) => {
    const changes = namesWithoutLength(ids);
    if (changes.length) rename(changes, `Removed the video length from ${changes.length} name(s)`);
  };

  return { findLengths, namesWithLength, namesWithoutLength, addLengthToNames, removeLengthFromNames };
}
