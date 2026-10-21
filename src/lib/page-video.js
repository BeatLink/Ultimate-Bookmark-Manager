// Reads the length of a page's video by opening the page in a tab and asking its video players, for pages whose player is built by scripts.

export const NO_VIDEO = 'No video with a length on the opened page';

// The longest length in seconds among the frame's videos, waiting up to `wait` ms for one to know its length; 0 for none. It runs inside the page, so it uses nothing from outside itself.
export function longestVideo(wait) {
  const longest = () => {
    let best = 0;
    for (const video of document.querySelectorAll('video')) {
      // A video told not to preload never learns its length, so it is asked for just the length.
      if (video.readyState === 0 && video.preload === 'none' && (video.src || video.querySelector('source'))) {
        video.preload = 'metadata';
        video.load();
      }
      // A live stream's length is Infinity, and one still loading is NaN.
      if (Number.isFinite(video.duration) && video.duration > best) best = video.duration;
    }
    return best;
  };
  const started = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const seconds = longest();
      if (seconds || Date.now() - started >= wait) resolve(seconds);
      else setTimeout(check, 500);
    };
    check();
  });
}

// Resolves once the tab has loaded its page, after `wait` ms, or when the search is cancelled.
function pageLoaded(api, tabId, wait, signal) {
  return new Promise((resolve) => {
    const isLoaded = (tab) => tab?.status === 'complete' && tab.url !== 'about:blank';
    const done = () => {
      clearTimeout(timer);
      api.tabs.onUpdated.removeListener(listen);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const listen = (id, change, tab) => {
      if (id === tabId && isLoaded(tab)) done();
    };
    const timer = setTimeout(done, wait);
    api.tabs.onUpdated.addListener(listen);
    signal?.addEventListener('abort', done);
    // The page may have loaded before the listener was added.
    api.tabs.get(tabId).then((tab) => isLoaded(tab) && done(), done);
  });
}

// Opens `url` in a muted background tab of `windowId`, reads its longest video, and closes the tab; { seconds } or { error }.
export async function pageVideoLength(url, { windowId, signal, loadWait = 20000, videoWait = 10000, api = globalThis.browser } = {}) {
  let tab;
  try {
    tab = await api.tabs.create({ windowId, url, active: false });
  } catch {
    return { error: 'Could not open the page' };
  }
  try {
    await api.tabs.update(tab.id, { muted: true });
    await pageLoaded(api, tab.id, loadWait, signal);
    if (signal?.aborted) return { error: 'Cancelled' };
    const frames = await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: longestVideo, args: [videoWait] });
    const seconds = Math.round(Math.max(0, ...frames.map((f) => f.result || 0)));
    return seconds ? { seconds } : { error: NO_VIDEO };
  } catch {
    return { error: 'Could not read the opened page' };
  } finally {
    api.tabs.remove(tab.id).catch(() => {});
  }
}

// Runs `read(url, windowId)` for each page inside one minimized window, which is closed afterwards.
export async function inPageWindow(read, api = globalThis.browser) {
  const win = await api.windows.create({ state: 'minimized' });
  try {
    return await read(win.id);
  } finally {
    api.windows.remove(win.id).catch(() => {});
  }
}
