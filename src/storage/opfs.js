// Stockage des fichiers GGUF dans OPFS (Origin Private File System).
const DIR_NAME = 'models';

async function getDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR_NAME, { create: true });
}

export async function findReadyFile(name, expectedSize) {
  try {
    const dir = await getDir();
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    return file.size === expectedSize ? file : null;
  } catch {
    return null;
  }
}

export async function modelsReady(config) {
  const model = await findReadyFile(config.model.name, config.model.size);
  if (!model) return false;
  if (!config.mmproj) return true;
  const mmproj = await findReadyFile(config.mmproj.name, config.mmproj.size);
  return Boolean(mmproj);
}

export async function downloadToOpfs(name, url, expectedSize, onProgress) {
  const existing = await findReadyFile(name, expectedSize);
  if (existing) {
    onProgress?.(expectedSize, expectedSize);
    return existing;
  }

  const dir = await getDir();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Téléchargement impossible (HTTP ${response.status})`);
  if (!response.body) throw new Error('Flux de téléchargement indisponible');

  const total = Number(response.headers.get('content-length')) || expectedSize;
  const reader = response.body.getReader();
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  let loaded = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total);
    }
    await writable.close();
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      // ignore
    }
    try {
      await dir.removeEntry(name);
    } catch {
      // ignore
    }
    throw err;
  }

  const file = await (await dir.getFileHandle(name)).getFile();
  if (file.size !== expectedSize) {
    try {
      await dir.removeEntry(name);
    } catch {
      // ignore
    }
    throw new Error('Fichier incomplet, réessaie.');
  }
  return file;
}

export async function getModelFiles(config) {
  const model = await findReadyFile(config.model.name, config.model.size);
  if (!model) throw new Error('Modèle principal introuvable dans le stockage local');
  if (!config.mmproj) return [model];
  const mmproj = await findReadyFile(config.mmproj.name, config.mmproj.size);
  if (!mmproj) throw new Error('Projecteur vision introuvable dans le stockage local');
  return [model, mmproj];
}
