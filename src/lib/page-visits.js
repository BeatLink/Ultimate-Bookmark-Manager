// Updates a bookmark's link status, page title and video length whenever its page is opened in a tab.

import { loadOutcome, isCheckable } from './linkcheck.js';
import { unhelpfulName } from './folders.js';
import { longestVideo } from './page-video.js';
import { loadSettings, loadLinkResults, saveLinkResults, loadVideoLengths, saveVideoLengths } from './settings.js';

// How long an opened page's videos get to learn their length.
const VIDEO_WAIT_MS = 10000;

// ===== Saved results =====

// Link results for when no check has run yet; a missing time tells the views no check has run.
const noCheckYet = () => ({ time: null, checked: 0, skipped: 0, cancelled: false, results: [], titles: {} });

// The saved link results with each bookmark's entry replaced by how its page just loaded, or null when nothing changes.
export function withLoadOutcome(saved, bookmarks, outcome) {
  if (!saved && outcome.status === 'ok') return null;
  const ids = new Set(bookmarks.map((b) => b.id));
  const kept = (saved?.results ?? []).filter((r) => !ids.has(r.id));
  const added = outcome.status === 'ok' ? [] : bookmarks.map((b) => ({ ...outcome, id: b.id, title: b.title }));
  return { ...(saved ?? noCheckYet()), results: [...kept, ...added] };
}

// The saved link results with the page title added for each bookmark without a useful name, or null when none needs it.
export function withPageTitle(saved, bookmarks, title) {
  const named = bookmarks.filter((b) => unhelpfulName(b.title, b.url) && !unhelpfulName(title, b.url));
  if (!named.length) return null;
  const titles = { ...saved?.titles };
  for (const b of named) titles[b.id] = { url: b.url, title: title.trim() };
  return { ...(saved ?? noCheckYet()), titles };
}

// ===== Watching opened pages =====

// The bookmarks at exactly this address; an address Firefox cannot look up has none.
const bookmarksAt = (api, url) => (isCheckable(url) ? api.bookmarks.search({ url }).catch(() => []) : Promise.resolve([]));

// The text after the status code in a line such as "HTTP/1.1 404 Not Found".
const statusTextOf = (statusLine) => (statusLine ?? '').replace(/^\S+\s+\d+\s*/, '');

export class VisitWatcher {
  constructor(api = globalThis.browser) {
    this.api = api;
    this.watching = false;
    // The address each page request started at, by request id, so a redirect can be told apart from the page asked for.
    this.started = new Map();
    // Saves run one after another, so two pages loading together cannot overwrite each other's results.
    this.saving = Promise.resolve();
  }

  // Starts listening, once; it needs the webRequest permission, which comes with the setting.
  watch() {
    if (this.watching || !this.api.webRequest) return;
    this.watching = true;
    const pages = { urls: ['<all_urls>'], types: ['main_frame'] };
    const { webRequest, tabs } = this.api;
    webRequest.onBeforeRequest.addListener((d) => { if (!this.started.has(d.requestId)) this.started.set(d.requestId, d.url); }, pages);
    webRequest.onCompleted.addListener((d) => this.requestDone(d).catch((err) => console.error('Updating a bookmark from its opened page failed', err)), pages);
    webRequest.onErrorOccurred.addListener((d) => this.started.delete(d.requestId), pages);
    tabs.onUpdated.addListener((tabId, change, tab) => {
      if (change.status === 'complete') this.pageLoaded(tab).catch((err) => console.error('Reading an opened bookmarked page failed', err));
    }, { properties: ['status'] });
  }

  queue(step) {
    this.saving = this.saving.then(step, step);
    return this.saving;
  }

  // Records how the page request went for the bookmarks at the address it started at and, after a redirect, at the one it ended on.
  async requestDone(details) {
    const url = this.started.get(details.requestId) ?? details.url;
    this.started.delete(details.requestId);
    if (details.tabId < 0 || details.incognito || !isCheckable(url)) return;
    const { updateOnVisit, linkCheck } = await loadSettings(this.api.storage.local);
    if (!updateOnVisit) return;
    const outcome = loadOutcome(url, {
      httpStatus: details.statusCode, statusText: statusTextOf(details.statusLine), finalUrl: details.url, detectLogin: linkCheck.detectLogin, loginHosts: linkCheck.loginHosts,
    });
    const visits = [[url, outcome]];
    if (outcome.status === 'redirect') visits.push([details.url, loadOutcome(details.url, { httpStatus: details.statusCode })]);
    for (const [at, result] of visits) {
      const bookmarks = await bookmarksAt(this.api, at);
      if (bookmarks.length) await this.queue(async () => this.saveLinks(withLoadOutcome(await loadLinkResults(this.api.storage.local), bookmarks, result)));
    }
  }

  // Reads the title and longest video of a loaded page for the bookmarks at its address.
  async pageLoaded(tab) {
    if (tab.incognito || !isCheckable(tab.url) || !(await loadSettings(this.api.storage.local)).updateOnVisit) return;
    const bookmarks = await bookmarksAt(this.api, tab.url);
    if (!bookmarks.length) return;
    if (tab.title) await this.queue(async () => this.saveLinks(withPageTitle(await loadLinkResults(this.api.storage.local), bookmarks, tab.title)));
    const seconds = await this.videoSeconds(tab.id);
    if (seconds) {
      await this.queue(async () => {
        const lengths = await loadVideoLengths(this.api.storage.local);
        for (const b of bookmarks) lengths[b.id] = { url: b.url, seconds };
        await saveVideoLengths(lengths, this.api.storage.local);
      });
    }
  }

  // The length in seconds of the longest video in the tab, or 0 when it has none or cannot be read.
  async videoSeconds(tabId) {
    if (!this.api.scripting) return 0;
    try {
      const frames = await this.api.scripting.executeScript({ target: { tabId, allFrames: true }, func: longestVideo, args: [VIDEO_WAIT_MS] });
      return Math.round(Math.max(0, ...frames.map((f) => f.result || 0)));
    } catch {
      return 0;
    }
  }

  async saveLinks(linkResults) {
    if (linkResults) await saveLinkResults(linkResults, this.api.storage.local);
  }
}
