// Service worker : cache hors ligne + en-tetes COOP/COEP (SharedArrayBuffer).
// Les chemins sont relatifs au dossier du service worker : l'app fonctionne a la
// racine (serveur de dev) comme dans un sous-dossier (GitHub Pages /llm-pocket/).
// Version du cache : a augmenter quand les fichiers de l'app changent, sinon le
// navigateur peut servir une version ancienne des modules.
const CACHE = 'llm-pocket-v11';

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/main.js',
  './src/config.js',
  './src/core/bus.js',
  './src/core/settings.js',
  './src/storage/idb.js',
  './src/storage/opfs.js',
  './src/engine/wllama-engine.js',
  './src/photos/photos.js',
  './src/robot/robot.js',
  './src/chat/chat.js',
  './src/avatar/avatar.css',
  './src/avatar/avatar.js',
  './src/avatar/avatar-screen.js',
  './src/avatar/debug.js',
  './src/avatar/speech.js',
  './src/voice/tts.js',
  './src/voice/dictation.js',
  './vendor/wllama/esm/index.js',
  './vendor/wllama/esm/wasm/wllama.wasm',
  './vendor/wllama/LICENCE',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

const CROSS_ORIGIN_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// Mode discret : active par '?debug=1' (URL de la page ou du service worker), une ligne par requete.
let debug = new URL(self.location).searchParams.get('debug') === '1';

function log(mode, url) {
  if (!debug) return;
  console.info('[sw] mode=' + mode + ' url=' + url.pathname);
}

function withHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CROSS_ORIGIN_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Reponse ecrite dans le cache seulement si elle est bonne : erreur, no-store ou opaque exclus.
function cacheable(response) {
  if (!response || !response.ok || response.type !== 'basic') return false;
  const control = response.headers.get('Cache-Control') || '';
  return !/(?:^|[,;])\s*no-store\b/i.test(control);
}

function served(mode, url, response) {
  log(mode, url);
  return withHeaders(response);
}

// '/tools/' et navigation : reseau d'abord, le cache ne sert que de secours hors ligne.
async function networkFirst(cache, request, url) {
  try {
    const response = await fetch(request);
    if (cacheable(response)) await cache.put(request, response.clone());
    return served('network-first', url, response);
  } catch (err) {
    const offline = await cache.match(request);
    if (offline) return served('cache-hit', url, offline);
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return served('cache-hit', url, fallback);
    }
    throw err;
  }
}

// Autres ressources (JS, CSS, WASM, polices, icons) : cache-first, puis revalidation en arriere-plan.
async function cacheFirst(event, cache, request, url) {
  const cached = await cache.match(request);
  if (!cached) return networkFirst(cache, request, url);

  const revalidate = fetch(request)
    .then((response) => (cacheable(response) ? cache.put(request, response.clone()) : null))
    .catch(() => {}); // reseau indisponible ou reponse non cacheable : on garde la version en cache
  event.waitUntil(revalidate);
  return served('cache-hit', url, cached);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // POST et requetes hors origine (modele Hugging Face) : le service worker ne les
  // met pas en cache et ne les intercepte pas.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.searchParams.get('debug') === '1') debug = true;

  // Les GGUF sont stockes en OPFS par l'application : le SW ne les met pas en cache.
  if (url.pathname.includes('/model/')) return;

  const pending = (async () => {
    const cache = await caches.open(CACHE);
    if (url.pathname.includes('/tools/') || request.mode === 'navigate') {
      return networkFirst(cache, request, url);
    }
    return cacheFirst(event, cache, request, url);
  })();

  event.respondWith(pending);
  // waitUntil est lance dans la tache de l'evenement : les revalidations ajoutees ensuite sont valides.
  event.waitUntil(pending);
});
