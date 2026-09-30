// Talks to Firefox's on-device AI (browser.trial.ml). Firefox gives each add-on one model per session, so the
// loaded model is remembered in session storage, which is cleared exactly when the add-on restarts.

const PERMISSION = { permissions: ['trialML'] };
// Keep the model in memory between runs for a while instead of Firefox's two-minute default.
const IDLE_MS = 10 * 60 * 1000;
const BATCH = 16;

export class ModelSwitchError extends Error {
  constructor(loaded, wanted) {
    super(`The ${loaded.task === 'summarization' ? 'summary' : 'embedding'} model ${loaded.model} is loaded, and Firefox allows one model per add-on session.`);
    this.loaded = loaded;
    this.wanted = wanted;
  }
}

// Must be called straight from a click, and on its own: Firefox refuses to ask for it together with anything else.
export function requestPermission() {
  return browser.permissions.request(PERMISSION);
}

// Whether the AI can run here, with steps for the user when it cannot.
export async function status() {
  if (!(await browser.permissions.contains(PERMISSION))) {
    return { ok: false, needsPermission: true, message: 'The AI organizer needs permission to download and run AI models on your device.' };
  }
  if (!browser.trial?.ml) {
    return { ok: false, message: 'Permission is granted, but this page started before it was. Reload the page to use the AI organizer.' };
  }
  return { ok: true };
}

export async function loadedModel() {
  const { aiEngine } = await browser.storage.session.get('aiEngine');
  return aiEngine ?? null;
}

// Explains the errors Firefox gives when its AI features are switched off or the machine is too small.
function friendly(err) {
  const text = String(err?.message ?? err);
  if (/disabled/i.test(text)) return new Error('Firefox’s AI features are turned off. Allow them in Firefox Settings (AI features), or set extensions.ml.enabled and browser.ml.enable to true in about:config, then try again.');
  if (/NotEnoughMemory|memory/i.test(text)) return new Error('Firefox did not start the model because this device has too little free memory.');
  if (/Forbidden URL|DISALLOWED|DENIED/i.test(text)) return new Error('Firefox refused to download this model; only models from Xenova, Mozilla or onnx-community on Hugging Face are allowed.');
  return err instanceof Error ? err : new Error(text);
}

// Makes sure the wanted model is the one loaded; loading a different one needs an add-on restart.
async function ensureEngine(task, model, device, onModel) {
  const wanted = { task, model, device };
  const loaded = await loadedModel();
  if (loaded) {
    if (loaded.task === task && loaded.model === model && loaded.device === device) return;
    throw new ModelSwitchError(loaded, wanted);
  }
  // Firefox reports progress per file (tokenizer, config, model weights), each running to 100%.
  const listener = (p) => {
    const file = p.metadata?.file ? ` ${p.metadata.file}` : '';
    if (p.type === 'downloading' && p.statusText !== 'done') {
      const pct = Number.isFinite(p.progress) ? ` ${Math.round(p.progress)}%` : '';
      onModel?.(`Downloading ${model}:${file}${pct}`);
    } else if (p.type === 'loading_from_cache') {
      onModel?.(`Loading ${model} from disk`);
    }
  };
  browser.trial.ml.onProgress.addListener(listener);
  try {
    await browser.trial.ml.createEngine({
      taskName: task, modelHub: 'huggingface', modelId: model, dtype: 'q8', device, timeoutMS: IDLE_MS,
    });
  } catch (err) {
    if (/already created/i.test(String(err?.message ?? err))) throw new ModelSwitchError({ task: 'unknown', model: 'another model' }, wanted);
    throw friendly(err);
  } finally {
    browser.trial.ml.onProgress.removeListener(listener);
  }
  await browser.storage.session.set({ aiEngine: wanted });
}

async function runEngine(args, options) {
  try {
    return await browser.trial.ml.runEngine({ args, options });
  } catch (err) {
    throw friendly(err);
  }
}

// Returns one unit-length vector per text.
export async function embed(texts, { model, device = 'wasm', signal, onModel, onItem }) {
  await ensureEngine('feature-extraction', model, device, onModel);
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const res = await runEngine([texts.slice(i, i + BATCH)], { pooling: 'mean', normalize: true });
    for (let j = 0; j < Math.min(BATCH, texts.length - i); j++) out.push(Array.from(res[j]));
    onItem?.(out.length);
  }
  return out;
}

// Summarizes each text, one model run at a time so progress can be shown.
export async function summarize(texts, { model, device = 'wasm', signal, onModel, onItem }) {
  await ensureEngine('summarization', model, device, onModel);
  const out = [];
  for (const text of texts) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const res = await runEngine([text], { max_new_tokens: 80 });
    out.push(String(res?.[0]?.summary_text ?? '').trim());
    onItem?.(out.length - 1);
  }
  return out;
}

export async function deleteModels() {
  await browser.trial.ml.deleteCachedModels();
}
