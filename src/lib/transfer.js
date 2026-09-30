// Settings files: what an export contains and how an import is checked before it is applied.

import { DEFAULT_SETTINGS, merge, migrateRules } from './settings.js';

export const FORMAT = 'bookmark-manager-settings';

export async function buildExport(storage = browser.storage.local) {
  const { settings, whitelist } = await storage.get(['settings', 'whitelist']);
  return {
    format: FORMAT,
    version: 1,
    exported: new Date().toISOString(),
    settings: merge(DEFAULT_SETTINGS, settings),
    whitelist: whitelist ?? {},
  };
}

// Parses an exported file, throwing a readable error when it is not one.
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  if (data?.format !== FORMAT) throw new Error('This is not a Bookmark Manager settings file.');
  if (data.version > 1) throw new Error('This file comes from a newer version of the add-on.');
  if (typeof data.settings !== 'object' || data.settings === null) throw new Error('The file has no settings in it.');
  const whitelist = data.whitelist && typeof data.whitelist === 'object' ? data.whitelist : {};
  const settings = merge(DEFAULT_SETTINGS, data.settings);
  // Files exported before rules used react-querybuilder's shape are converted as they are read.
  settings.organize.rules = migrateRules(settings.organize.rules ?? []);
  return { settings, whitelist, rules: settings.organize.rules.length };
}

// Replaces the settings and adds the file's ignored items to the ones already here.
export async function applyImport(parsed, storage = browser.storage.local) {
  const { whitelist } = await storage.get('whitelist');
  await storage.set({ settings: parsed.settings, whitelist: { ...(whitelist ?? {}), ...parsed.whitelist } });
}
