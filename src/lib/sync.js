// Keeps settings, rules and ignored items in step across devices through Firefox Sync (storage.sync).

const META = 'cfg_meta';
const CHUNK = 'cfg_';
// Firefox allows 8 KiB per item and 100 KiB in all; stay under both with room to spare.
const ITEM_BUDGET = 8000;
const TOTAL_BUDGET = 96000;
// Room left in each item for its key name.
const KEY_BYTES = 16;

const bytes = (s) => new TextEncoder().encode(s).length;

// True for the sync items this add-on writes.
export const isSyncKey = (key) => key.startsWith(CHUNK);

// A fast string fingerprint used to tell whether two payloads are the same.
export function fingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + text.length.toString(16);
}

// Cuts text into pieces that each fit one sync item once stored as JSON.
export function splitChunks(text, budget = ITEM_BUDGET) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let size = Math.min(budget, text.length - i);
    // A piece measured in characters may be too big in bytes, so it shrinks by a fifth until it fits.
    while (bytes(JSON.stringify(text.slice(i, i + size))) + KEY_BYTES > budget) size = Math.floor(size * 0.8);
    chunks.push(text.slice(i, i + size));
    i += size;
  }
  return chunks.length ? chunks : [''];
}

export async function isSyncEnabled(local) {
  const { syncEnabled } = await local.get('syncEnabled');
  return syncEnabled !== false;
}

export async function syncStatus(local) {
  const { syncState } = await local.get('syncState');
  return syncState ?? {};
}

async function remoteMeta(sync) {
  return (await sync.get(META))[META] ?? null;
}

// The payload is settings plus ignored items, or settings alone when the ignore list is too big to sync.
async function localPayload(local) {
  const { settings, whitelist } = await local.get(['settings', 'whitelist']);
  const full = JSON.stringify({ settings: settings ?? null, whitelist: whitelist ?? {} });
  if (bytes(full) <= TOTAL_BUDGET) return { text: full, partial: false };
  const partial = JSON.stringify({ settings: settings ?? null });
  if (bytes(partial) > TOTAL_BUDGET) throw new Error('Settings are too large to sync.');
  return { text: partial, partial: true };
}

// Uploads this device's settings unless they are already what was last synced.
export async function push(local, sync, { force = false } = {}) {
  const { text, partial } = await localPayload(local);
  const hash = fingerprint(text);
  const state = await syncStatus(local);
  if (!force && state.hash === hash) return 'unchanged';

  const chunks = splitChunks(text);
  const old = await remoteMeta(sync);
  await sync.set(Object.fromEntries(chunks.map((c, i) => [CHUNK + i, c])));
  // The meta item goes last, so another device never assembles a half-written payload.
  await sync.set({ [META]: { hash, chunks: chunks.length, updated: Date.now(), partial } });
  if (old && old.chunks > chunks.length) {
    await sync.remove(Array.from({ length: old.chunks - chunks.length }, (_, i) => CHUNK + (chunks.length + i)));
  }
  await local.set({ syncState: { hash, time: Date.now(), partial } });
  return 'pushed';
}

// Applies the synced settings here when they differ from what this device last saw.
export async function pull(local, sync) {
  const meta = await remoteMeta(sync);
  if (!meta) return 'empty';
  const state = await syncStatus(local);
  if (state.hash === meta.hash) return 'unchanged';

  const keys = Array.from({ length: meta.chunks }, (_, i) => CHUNK + i);
  const stored = await sync.get(keys);
  const text = keys.map((k) => stored[k] ?? '').join('');
  // Chunks and meta can arrive separately; wait for the next change if they do not add up yet.
  if (fingerprint(text) !== meta.hash) return 'incomplete';

  const data = JSON.parse(text);
  const update = { syncState: { hash: meta.hash, time: Date.now(), partial: meta.partial } };
  if (data.settings) update.settings = data.settings;
  if ('whitelist' in data) update.whitelist = data.whitelist;
  await local.set(update);
  return 'pulled';
}

// Brings both sides together at startup: a device that has never synced takes the synced copy if one exists.
export async function reconcile(local, sync) {
  if (!(await isSyncEnabled(local))) return 'disabled';
  const state = await syncStatus(local);
  const meta = await remoteMeta(sync);
  if (meta && meta.hash !== state.hash) return pull(local, sync);
  return push(local, sync);
}

// True when synced settings exist that differ from this device's, so turning sync on must pick a side.
export async function hasConflictingRemote(local, sync) {
  const meta = await remoteMeta(sync);
  if (!meta) return false;
  const { text } = await localPayload(local);
  return fingerprint(text) !== meta.hash;
}

// Turns sync on, either adopting the synced copy or replacing it with this device's settings.
export async function enableSync(local, sync, { preferRemote }) {
  await local.set({ syncEnabled: true, syncState: {} });
  if (preferRemote && (await remoteMeta(sync))) return pull(local, sync);
  return push(local, sync, { force: true });
}

export async function disableSync(local) {
  await local.set({ syncEnabled: false, syncState: {} });
}

// Runs a sync step and records a failure where the settings page can show it.
export async function guarded(local, step) {
  try {
    return await step();
  } catch (err) {
    const state = await syncStatus(local);
    await local.set({ syncState: { ...state, error: String(err.message ?? err), errorTime: Date.now() } });
    return 'error';
  }
}
