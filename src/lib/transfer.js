// Settings files: what an export contains and how an import is checked before it is applied.

import { readSettings, readWhitelist } from './settings.js';

const FORMAT = 'bookmark-manager-settings';

export async function buildExport(storage = browser.storage.local) {
  const { settings, whitelist } = await storage.get(['settings', 'whitelist']);
  return {
    format: FORMAT,
    version: 1,
    exported: new Date().toISOString(),
    settings: readSettings(settings),
    whitelist: readWhitelist(whitelist),
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
  if (data?.format !== FORMAT) throw new Error('This is not an Ultimate Bookmark Manager settings file.');
  if (data.version > 1) throw new Error('This file comes from a newer version of the add-on.');
  if (typeof data.settings !== 'object' || data.settings === null) throw new Error('The file has no settings in it.');
  const whitelist = readWhitelist(data.whitelist);
  // The file is read like stored settings, so rules in an older shape are converted and damaged values replaced.
  const settings = readSettings(data.settings);
  return { settings, whitelist, rules: settings.organize.rules.length };
}

// Replaces the settings and adds the file's ignored items to the ones already here.
export async function applyImport(parsed, storage = browser.storage.local) {
  const { whitelist } = await storage.get('whitelist');
  await storage.set({ settings: parsed.settings, whitelist: { ...(whitelist ?? {}), ...parsed.whitelist } });
}
