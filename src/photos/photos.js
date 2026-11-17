// Traitement des photos : redimensionnement + encodage JPEG.
// Deux versions sont produites :
//  - un JPEG 1024 px max pour le modele de vision ;
//  - une vignette 320 px (data URL) pour l'historique et l'affichage.
const MAX_SIDE = 1024;
const THUMB_SIDE = 320;

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // repli sur <img> ci-dessous
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible'));
    };
    img.src = url;
  });
}

function drawScaled(bitmap, maxSide) {
  const width = bitmap.width;
  const height = bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function preparePhoto(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Fichier image attendu');

  const bitmap = await loadBitmap(file);
  try {
    const mainBlob = await canvasToBlob(drawScaled(bitmap, MAX_SIDE), 0.86);
    const thumbBlob = await canvasToBlob(drawScaled(bitmap, THUMB_SIDE), 0.72);
    if (!mainBlob || !thumbBlob) throw new Error('Conversion image impossible');

    return {
      buffer: await mainBlob.arrayBuffer(),
      thumbDataUrl: await blobToDataUrl(thumbBlob),
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}
