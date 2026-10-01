// Persistent settings, whitelist and saved link-check results in storage.local.

import { DEFAULT_MATCHING } from './duplicates.js';
import { dropRetiredRanking } from './rule-order.js';
import { migrateRule, isWellFormedRule } from './organize.js';
import { DEFAULT_LOGIN_HOSTS, DEFAULT_NO_COOKIE_WORDS } from './linkcheck.js';

export const DEFAULT_SETTINGS = {
  matching: { ...DEFAULT_MATCHING },
  rules: [],
  dupesFolderName: 'Dupes',
  linkCheck: {
    concurrency: 6,
    timeoutSeconds: 15,
    skipDomains: [],
    skipPrivate: true,
    useCookies: false,
    noCookieWords: [...DEFAULT_NO_COOKIE_WORDS],
    detectLogin: true,
    loginHosts: [...DEFAULT_LOGIN_HOSTS],
  },
  historyLimit: 50,
  historyDays: 30,
  organize: {
    rules: [],
    autoApply: false,
  },
};

// Lists of text; every other list in the settings holds objects.
const TEXT_LISTS = new Set(['skipDomains', 'noCookieWords', 'loginHosts']);
// The numbers the settings page allows, so a damaged value cannot ask for a billion parallel requests.
const RANGES = { concurrency: [1, 32], timeoutSeconds: [3, 120], historyLimit: [1, 500], historyDays: [1, 3650] };
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Stored settings laid over the defaults; a value of the wrong type, as a damaged file or sync could bring, falls back to the default.
export function merge(defaults, stored, key = '') {
  if (Array.isArray(defaults)) {
    if (!Array.isArray(stored)) return structuredClone(defaults);
    return stored.filter(TEXT_LISTS.has(key) ? (v) => typeof v === 'string' : isObject);
  }
  if (isObject(defaults)) {
    if (!isObject(stored)) return structuredClone(defaults);
    const out = {};
    for (const [k, v] of Object.entries(defaults)) out[k] = merge(v, stored[k], k);
    // Settings this version does not know, from a newer one through sync, are kept so saving here does not drop them.
    for (const [k, v] of Object.entries(stored)) if (!(k in defaults) && k !== '__proto__') out[k] = v;
    return out;
  }
  if (typeof stored !== typeof defaults || (typeof stored === 'number' && !Number.isFinite(stored))) return defaults;
  if (RANGES[key]) return Math.min(RANGES[key][1], Math.max(RANGES[key][0], stored));
  return stored;
}

// Organize rules in their current shape, leaving out any too damaged to read.
export function readRules(rules) {
  const out = [];
  // Priority numbers and fallback flags are retired; ranking lists replace them.
  for (const rule of dropRetiredRanking(rules)) {
    try {
      const current = migrateRule(rule);
      if (isWellFormedRule(current)) out.push(current);
    } catch {
      // A rule the converter cannot read is left out.
    }
  }
  return out;
}

// Settings from storage, sync or a file, with anything damaged replaced by its default or left out.
export function readSettings(stored) {
  const settings = merge(DEFAULT_SETTINGS, stored);
  settings.organize.rules = readRules(settings.organize.rules);
  return settings;
}

export async function loadSettings(storage = browser.storage.local) {
  const { settings } = await storage.get('settings');
  const loaded = readSettings(settings);
  const stored = isObject(settings?.organize) && Array.isArray(settings.organize.rules) ? settings.organize.rules : [];
  const rules = loaded.organize.rules;
  if (rules.length !== stored.length || rules.some((r, i) => r !== stored[i])) {
    // Converted rules are saved straight back, so they are converted once and synced in the new shape.
    await storage.set({ settings: { ...settings, organize: { ...settings.organize, rules } } });
  }
  return loaded;
}

// Ignored items as id → { title, url, inside }, leaving out entries that are not; `inside` marks a folder ignored with everything in it.
export function readWhitelist(whitelist) {
  const out = {};
  if (!isObject(whitelist)) return out;
  for (const [id, e] of Object.entries(whitelist)) {
    if (!isObject(e) || id === '__proto__') continue;
    out[id] = { title: String(e.title ?? ''), url: String(e.url ?? '') };
    if (e.inside === true) out[id].inside = true;
  }
  return out;
}

// Adds the never-send-cookies words a saved list predates, once, so a word removed afterwards stays removed.
export async function addNewCookieWords(storage = browser.storage.local) {
  const { settings, cookieWordsAdded } = await storage.get(['settings', 'cookieWordsAdded']);
  if (cookieWordsAdded) return false;
  const words = settings?.linkCheck?.noCookieWords;
  const update = { cookieWordsAdded: true };
  if (Array.isArray(words)) {
    const missing = DEFAULT_NO_COOKIE_WORDS.filter((w) => !words.includes(w));
    if (missing.length) update.settings = { ...settings, linkCheck: { ...settings.linkCheck, noCookieWords: [...words, ...missing] } };
  }
  await storage.set(update);
  return 'settings' in update;
}

export async function saveSettings(settings, storage = browser.storage.local) {
  await storage.set({ settings });
}

// The whitelist maps bookmark id to a label so the settings page can show what each entry was.
export async function loadWhitelist(storage = browser.storage.local) {
  const { whitelist } = await storage.get('whitelist');
  return readWhitelist(whitelist);
}

export async function addToWhitelist(entries, storage = browser.storage.local) {
  const whitelist = await loadWhitelist(storage);
  for (const e of entries) whitelist[e.id] = { title: e.title ?? '', url: e.url ?? '', ...(e.inside ? { inside: true } : {}) };
  await storage.set({ whitelist });
  return whitelist;
}

export async function removeFromWhitelist(ids, storage = browser.storage.local) {
  const whitelist = await loadWhitelist(storage);
  for (const id of ids) delete whitelist[id];
  await storage.set({ whitelist });
  return whitelist;
}

export async function loadLinkResults(storage = browser.storage.local) {
  const { linkResults } = await storage.get('linkResults');
  return linkResults ?? null;
}

export async function saveLinkResults(linkResults, storage = browser.storage.local) {
  await storage.set({ linkResults });
}
