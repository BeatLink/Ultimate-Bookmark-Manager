// Persistent settings, whitelist and saved link-check results in storage.local.

import { DEFAULT_MATCHING } from './duplicates.js';
import { dropRetiredRanking } from './rule-order.js';
import { migrateRule } from './organize.js';

export const DEFAULT_SETTINGS = {
  matching: { ...DEFAULT_MATCHING },
  rules: [],
  dupesFolderName: 'Dupes',
  linkCheck: {
    concurrency: 6,
    timeoutSeconds: 15,
    skipDomains: ['localhost', '127.0.0.1'],
  },
  historyLimit: 50,
  organize: {
    rules: [],
    autoApply: false,
  },
};

export function merge(defaults, stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(defaults)) return stored ?? defaults;
  const out = { ...defaults };
  for (const [k, v] of Object.entries(stored)) {
    out[k] = defaults[k] && typeof defaults[k] === 'object' && !Array.isArray(defaults[k]) ? merge(defaults[k], v) : v;
  }
  return out;
}

export async function loadSettings(storage = browser.storage.local) {
  const { settings } = await storage.get('settings');
  const loaded = merge(DEFAULT_SETTINGS, settings);
  // Priority numbers and fallback flags are retired; ranking lists replace them.
  loaded.organize.rules = dropRetiredRanking(loaded.organize.rules ?? []);
  const rules = migrateRules(loaded.organize.rules);
  if (rules !== loaded.organize.rules) {
    loaded.organize.rules = rules;
    // Converted rules are saved straight back, so they are converted once and synced in the new shape.
    await storage.set({ settings: { ...settings, organize: { ...settings.organize, rules } } });
  }
  return loaded;
}

// Rules in react-querybuilder's shape; the same list comes back when none needed converting.
export function migrateRules(rules) {
  const out = rules.map(migrateRule);
  return out.some((r, i) => r !== rules[i]) ? out : rules;
}

export async function saveSettings(settings, storage = browser.storage.local) {
  await storage.set({ settings });
}

// The whitelist maps bookmark id to a label so the settings page can show what each entry was.
export async function loadWhitelist(storage = browser.storage.local) {
  const { whitelist } = await storage.get('whitelist');
  return whitelist ?? {};
}

export async function addToWhitelist(entries, storage = browser.storage.local) {
  const whitelist = await loadWhitelist(storage);
  for (const e of entries) whitelist[e.id] = { title: e.title ?? '', url: e.url ?? '' };
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
