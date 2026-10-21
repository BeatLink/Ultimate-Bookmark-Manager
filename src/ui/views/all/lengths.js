// Each bookmark's video length, kept in storage.local, and the command that finds lengths for the selection.

import { toast } from '../../dom.js';
import { isBookmark } from '../../../lib/tree.js';
import { checkTargets, fetchOptions } from '../../../lib/linkcheck.js';
import { loadLengths, mergeLengths, lengthFor, NO_LENGTH } from '../../../lib/video-lengths.js';
import { loadVideoLengths, saveVideoLengths } from '../../../lib/settings.js';
import { formatLength } from '../../../lib/html-video.js';
import { ProgressJob } from '../../progress.js';
import { askAllSites } from '../../permissions.js';
import { view, saveColumns } from './state.js';

// `at` changes whenever the saved lengths do, so the details pane knows to redraw.
export const lengths = { saved: null, at: 0, loading: null };
// Why the last search found no length for a bookmark.
export const failures = new Map();

// The running search, kept here so switching views does not lose it.
export const job = new ProgressJob((done, total) => `Finding video lengths: ${done} of ${total}`);

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

  // Finds the length of each selected bookmark and of every bookmark inside the selected folders; straight from the click, so Firefox may ask for permission.
  const findLengths = (ids) => {
    if (job.running) return toast('Video lengths are already being found.');
    const wanted = new Set();
    const collect = (n) => {
      if (isBookmark(n)) wanted.add(n.id);
      n.children?.forEach(collect);
    };
    ids.map(get).filter(Boolean).forEach(collect);
    const { targets, skipped } = checkTargets(ctx.state.flat, ctx.state.settings.linkCheck, new Set(), wanted);
    if (!targets.length) {
      return toast(skipped ? 'The link check skips every selected page, so it has no length to find.' : 'Select bookmarks or folders to find video lengths for.', 'error');
    }
    askAllSites().then(async (granted) => {
      if (!granted) return toast('Finding video lengths needs permission to access websites.', 'error');
      const signal = job.start(targets.length);
      let results;
      try {
        results = await loadLengths(targets, { ...fetchOptions(ctx.state.settings.linkCheck), signal, onProgress: (done) => job.progress(done) });
      } catch (err) {
        return toast(`Could not load pages: ${err.message ?? err}`, 'error');
      } finally {
        job.finish();
      }
      for (const b of targets) failures.delete(b.id);
      for (const [id, r] of results) if (r.error) failures.set(id, r.error);
      const saved = lengths.saved ?? (await loadVideoLengths().catch(() => ({})));
      keep(mergeLengths(saved, targets, results, new Set(ctx.state.flat.map((b) => b.id))));
      try {
        await saveVideoLengths(lengths.saved);
      } catch (err) {
        toast(`Could not save the video lengths: ${err.message ?? err}`, 'error');
      }
      if (!view.columns.length) {
        view.columns.length = true;
        saveColumns();
      }
      ctx.render();
      const found = [...results.values()].filter((r) => r.seconds).length;
      const missed = results.size - found;
      const message = `Found the video length of ${found} of ${targets.length} page(s).`
        + (missed ? ` ${missed} had none; select one to see why.` : '')
        + (skipped ? ` ${skipped} skipped by the link check’s settings.` : '');
      toast(message, found ? 'success' : 'error');
    });
  };

  return { findLengths };
}
