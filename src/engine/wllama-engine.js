// Moteur d'inference : wllama v3 (llama.cpp compile en WebAssembly).
import { Wllama, LoggerWithoutDebug } from '../../vendor/wllama/esm/index.js';
import { CONFIG, modelProfile } from '../config.js';
import * as opfs from '../storage/opfs.js';

const WASM_URL = new URL('../../vendor/wllama/esm/wasm/wllama.wasm', import.meta.url).href;

function stripThinking(text) {
  return text.replace(/<think[\s\S]*?<\/think>\s*/g, '').trim();
}

// navigator.gpu may exist while the device has no usable adapter. In that case
// a GPU load aborts the wllama worker, so probe the adapter before choosing GPU.
async function hasWebGpuAdapter() {
  if (!navigator.gpu?.requestAdapter) return false;
  try {
    return Boolean(await navigator.gpu.requestAdapter());
  } catch {
    return false;
  }
}

// Le worker wllama signale un manque de memoire par des erreurs brutes
// ("(ABORT)", "ggml_aligned_malloc: insufficient memory", "already initialized").
// On les traduit pour que l'ecran de reglage dise ce qui s'est passe.
const MEMORY_ERROR_RE = /abort|alloc|memory|out of memory|oom|already initialized/i;

function friendlyLoadError(err) {
  const message = String(err?.message ?? err);
  if (MEMORY_ERROR_RE.test(message)) {
    return new Error(
      'Mémoire insuffisante pour charger le modèle sur cet appareil. Essayez un modèle plus petit ou un autre navigateur.'
    );
  }
  return err instanceof Error ? err : new Error(message);
}

export class Engine extends EventTarget {
  #wllama = null;
  #abort = null;

  get ready() {
    return this.#wllama !== null;
  }

  // Profil actif : il determine les fichiers, la taille du contexte et la vision.
  get profile() {
    return modelProfile();
  }

  async isModelStored() {
    return opfs.modelsReady(this.profile);
  }

  async downloadModel(onProgress) {
    const items = [this.profile.model, this.profile.mmproj].filter(Boolean);
    const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
    let doneBefore = 0;
    for (const item of items) {
      await opfs.downloadToOpfs(item.name, item.url, item.size, (loaded) => {
        onProgress?.({ file: item.name, loaded: doneBefore + loaded, total: totalBytes });
      });
      doneBefore += item.size;
    }
  }

  async load() {
    if (this.#wllama) return this.#wllama.getLoadedContextInfo();

    const createWllama = () =>
      new Wllama(
        { default: WASM_URL },
        { suppressNativeLog: true, logger: LoggerWithoutDebug }
      );

    let wllama = createWllama();
    const profile = this.profile;
    const files = await opfs.getModelFiles(profile);
    const useGpu = await hasWebGpuAdapter();
    const baseParams = { n_ctx: profile.nCtx, jinja: true, warmup: false };

    try {
      await wllama.loadModel(files, { ...baseParams, n_gpu_layers: useGpu ? -1 : 0 });
    } catch (err) {
      if (!useGpu) throw friendlyLoadError(err);
      console.warn('[engine] chargement GPU impossible, repli CPU', err);
      try {
        await wllama.exit();
      } catch {
        // The crashed GPU worker may already be unreachable.
      }
      wllama = createWllama();
      try {
        await wllama.loadModel(files, { ...baseParams, n_gpu_layers: 0 });
      } catch (cpuErr) {
        throw friendlyLoadError(cpuErr);
      }
    }

    const info = wllama.getLoadedContextInfo();
    if (info?.success === false) {
      try {
        await wllama.exit();
      } catch {
        // Ignore cleanup failure, the load error is the useful one.
      }
      this.#wllama = null;
      throw new Error('Chargement du modèle impossible sur cet appareil.');
    }

    this.#wllama = wllama;
    this.dispatchEvent(new CustomEvent('ready', { detail: info }));
    return info;
  }

  async generate(messages, { onDelta, maxTokens } = {}) {
    if (!this.#wllama) throw new Error('Le moteur n\'est pas chargé');

    this.#abort = new AbortController();
    const stream = await this.#wllama.createChatCompletion({
      messages,
      stream: true,
      abortSignal: this.#abort.signal,
      max_tokens: maxTokens ?? CONFIG.maxTokens,
      temperature: CONFIG.temperature,
      top_p: 0.9,
      top_k: 40,
      min_p: 0.05,
      penalty_repeat: 1.05,
      chat_template_kwargs: { enable_thinking: false },
    });

    let text = '';
    let timings = null;
    try {
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          onDelta?.(delta, text);
        }
        if (chunk.timings) timings = chunk.timings;
      }
    } finally {
      this.#abort = null;
    }

    return { text: stripThinking(text), timings };
  }

  stop() {
    this.#abort?.abort();
  }
}
