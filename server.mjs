// Serveur de dev statique.
// En-tetes COOP/COEP requis pour SharedArrayBuffer (wllama multi-thread).
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8137;

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
  ['.wasm', 'application/wasm'],
  ['.gguf', 'application/octet-stream'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const BASE_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const rel = normalize(pathname).replace(/^[\\/]+/, '');
  const filePath = join(ROOT, rel);

  if (!filePath.startsWith(ROOT + sep)) {
    res.writeHead(403, BASE_HEADERS);
    res.end('Forbidden');
    return;
  }

  let st;
  try {
    st = statSync(filePath);
  } catch {
    res.writeHead(404, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found: /' + rel);
    return;
  }

  if (st.isDirectory()) {
    res.writeHead(302, { ...BASE_HEADERS, Location: pathname + '/' });
    res.end();
    return;
  }

  const type = MIME.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream';
  res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': st.size });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
  console.log(`[dev] ${req.method} /${rel} (${st.size} o)`);
});

server.listen(PORT, () => {
  console.log(`LLM Pocket - serveur de dev : http://localhost:${PORT}`);
  console.log('COOP/COEP actifs : SharedArrayBuffer disponible (wllama multi-thread).');
});
