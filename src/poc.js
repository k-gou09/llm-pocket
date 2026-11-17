// PoC M0 : prouver que wllama v3 charge les 2 GGUF et genere texte + vision.
import { Wllama } from '../vendor/wllama/esm/index.js';

const $ = (id) => document.getElementById(id);
const out = $('out');
const stats = $('stats');
const statusEl = $('status');
const fill = $('fill');
const envEl = $('env');
const promptEl = $('prompt');
const imgFile = $('imgFile');
const preview = $('preview');

const WASM = new URL('../vendor/wllama/esm/wasm/wllama.wasm', import.meta.url).href;
const wllama = new Wllama({ default: WASM });

const state = {
  loaded: false,
  running: false,
  hasImage: false,
  multithread: false,
  loadMs: 0,
  lastText: '',
  timings: null,
  error: null,
};

envEl.textContent = [
  'SharedArrayBuffer: ' + ('SharedArrayBuffer' in globalThis),
  'crossOriginIsolated: ' + globalThis.crossOriginIsolated,
  'WebGPU: ' + ('gpu' in navigator),
].join(' | ');

function setStatus(text) {
  statusEl.textContent = text;
  console.log('[poc]', text);
}

function setProgress(pct) {
  fill.style.width = Math.min(100, pct) + '%';
}

function updateButtons() {
  $('btnLoad').disabled = state.loaded || state.running;
  $('btnText').disabled = !state.loaded || state.running;
  $('btnImage').disabled = !state.loaded || state.running || !state.hasImage;
  $('btnStop').disabled = !state.running;
}

async function load() {
  if (state.loaded || state.running) return;
  state.running = true;
  state.error = null;
  updateButtons();
  const t0 = performance.now();
  try {
    setStatus('Chargement du modele (GGUF 527 Mo + mmproj 207 Mo)...');
    await wllama.loadModelFromUrl(
      { url: '/model/Qwen3.5-0.8B-Q4_K_M.gguf', mmprojUrl: '/model/mmproj-Qwen3.5-0.8B-BF16.gguf' },
      {
        n_ctx: 2048,
        n_gpu_layers: 0,
        jinja: true,
        warmup: false,
        useCache: false,
        progressCallback: ({ loaded, total }) => {
          const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
          setProgress(pct);
          setStatus(`Telechargement ${pct}% (${(loaded / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} Mo)`);
        },
      }
    );
    state.loadMs = Math.round(performance.now() - t0);
    state.loaded = true;
    const info = wllama.getLoadedContextInfo();
    state.hasImage = info.has_image_input;
    state.multithread = wllama.isMultithread();
    setProgress(100);
    setStatus(`Modele charge en ${state.loadMs} ms (multi-thread: ${state.multithread}, vision: ${state.hasImage})`);
    stats.textContent = JSON.stringify(
      {
        loadMs: state.loadMs,
        multithread: state.multithread,
        threads: wllama.getNumThreads(),
        nCtx: info.n_ctx,
        nCtxTrain: info.n_ctx_train,
        nLayer: info.n_layer,
        hasImageInput: info.has_image_input,
        hasChatTemplate: wllama.getChatTemplate() != null,
        webgpuSupported: wllama.isSupportWebGPU(),
      },
      null,
      2
    );
  } catch (err) {
    state.error = String((err && err.stack) || err);
    setStatus('ERREUR chargement : ' + (err && err.message));
    console.error('[poc][erreur]', err);
  } finally {
    state.running = false;
    updateButtons();
  }
}

let abortCtrl = null;

async function run(kind) {
  if (!state.loaded || state.running) return;
  state.running = true;
  state.error = null;
  state.lastText = '';
  out.textContent = '';
  updateButtons();

  try {
    let content = promptEl.value.trim() || 'Dis bonjour.';
    let label = 'texte';

    if (kind === 'image') {
      const file = imgFile.files && imgFile.files[0];
      if (!file) {
        setStatus('Choisis une image d abord.');
        return;
      }
      const data = await file.arrayBuffer();
      content = [
        { type: 'image', data },
        { type: 'text', text: promptEl.value.trim() || 'Decris cette image en une phrase.' },
      ];
      label = 'image';
    }

    setStatus('Generation (' + label + ')...');
    const t0 = performance.now();
    abortCtrl = new AbortController();
    const stream = await wllama.createChatCompletion({
      messages: [{ role: 'user', content }],
      max_tokens: 200,
      temperature: 0.6,
      stream: true,
      abortSignal: abortCtrl.signal,
      chat_template_kwargs: { enable_thinking: false },
    });

    let text = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
      if (delta) {
        text += delta;
        out.textContent = text;
        out.scrollTop = out.scrollHeight;
      }
      if (chunk.timings) state.timings = chunk.timings;
    }

    state.lastText = text;
    const ms = Math.round(performance.now() - t0);
    const t = state.timings || {};
    setStatus(
      `OK (${label}) en ${ms} ms` +
        (t.predicted_per_second ? ` - ${t.predicted_per_second.toFixed(1)} tok/s` : '')
    );
    console.log(
      '[poc][resultat]',
      JSON.stringify({ kind: label, ms, chars: text.length, texte: text.slice(0, 400), timings: t })
    );
  } catch (err) {
    if (err && err.name === 'WllamaAbortError') {
      setStatus('Generation arretee.');
    } else {
      state.error = String((err && err.stack) || err);
      setStatus('ERREUR generation : ' + (err && err.message));
      console.error('[poc][erreur]', err);
    }
  } finally {
    abortCtrl = null;
    state.running = false;
    updateButtons();
  }
}

$('btnLoad').addEventListener('click', load);
$('btnText').addEventListener('click', () => run('text'));
$('btnImage').addEventListener('click', () => run('image'));
$('btnStop').addEventListener('click', () => {
  if (abortCtrl) abortCtrl.abort();
});

imgFile.addEventListener('change', () => {
  const file = imgFile.files && imgFile.files[0];
  if (!file) {
    preview.hidden = true;
    return;
  }
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
});

// Hooks pour automatisation (tests / debug console).
window.__poc = { state, load, run, wllama };
