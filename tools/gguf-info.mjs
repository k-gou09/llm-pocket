// Outil de diagnostic : affiche les metadonnees d'un fichier GGUF.
// Usage: node tools/gguf-info.mjs <fichier.gguf> [cle]
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node tools/gguf-info.mjs <fichier.gguf> [cle]");
  process.exit(1);
}

const buf = readFileSync(file);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let off = 4; // saute la magic "GGUF"

function u32() { const v = dv.getUint32(off, true); off += 4; return v; }
function u64() { const v = dv.getBigUint64(off, true); off += 8; return Number(v); }
function str() {
  const len = u64();
  const s = new TextDecoder().decode(buf.subarray(off, off + len));
  off += len;
  return s;
}

const version = u32();
u64(); // n_tensors
const kvCount = u64();

// Types GGUF: 0 uint8, 1 int8, 2 uint16, 3 int16, 4 uint32, 5 int32,
// 6 float32, 7 bool, 8 string, 9 array, 10 uint64, 11 int64, 12 float64
function elemSize(t) {
  switch (t) {
    case 0: case 1: case 7: return 1;
    case 2: case 3: return 2;
    case 4: case 5: case 6: return 4;
    case 10: case 11: case 12: return 8;
    default: return 0;
  }
}

function readValue(type) {
  switch (type) {
    case 0: { const v = dv.getUint8(off); off += 1; return v; }
    case 1: { const v = dv.getInt8(off); off += 1; return v; }
    case 2: { const v = dv.getUint16(off, true); off += 2; return v; }
    case 3: { const v = dv.getInt16(off, true); off += 2; return v; }
    case 4: { const v = dv.getUint32(off, true); off += 4; return v; }
    case 5: { const v = dv.getInt32(off, true); off += 4; return v; }
    case 6: { const v = dv.getFloat32(off, true); off += 4; return v; }
    case 7: { const v = buf[off] !== 0; off += 1; return v; }
    case 8: return str();
    case 9: {
      const n = u64();
      const t = u32();
      if (t === 8) {
        const items = [];
        for (let i = 0; i < n; i++) items.push(str());
        return items;
      }
      const sz = elemSize(t);
      if (sz > 0) { off += n * sz; return `[${n} elements type ${t}]`; }
      throw new Error(`Tableau imbrique non supporte (type ${t})`);
    }
    case 10: { const v = dv.getBigUint64(off, true).toString(); off += 8; return v; }
    case 11: { const v = dv.getBigInt64(off, true).toString(); off += 8; return v; }
    case 12: { const v = dv.getFloat64(off, true); off += 8; return v; }
    default: throw new Error(`Type inconnu ${type}`);
  }
}

const wanted = process.argv[3];
console.log(`Fichier : ${file}`);
console.log(`Version GGUF : ${version} | Paires cle/valeur : ${kvCount}\n`);
let found = false;

for (let i = 0; i < kvCount; i++) {
  const key = str();
  const type = u32();
  if (wanted && key !== wanted) { readValue(type); continue; }
  found = true;
  const value = readValue(type);
  const s = Array.isArray(value) ? JSON.stringify(value) : String(value);
  console.log(`\n=== ${key} (${s.length} caracteres) ===`);
  if (wanted && s.length > 2000) {
    writeFileSync("tools/chat-template.txt", s);
    console.log("(valeur longue ecrite dans tools/chat-template.txt)");
    console.log(s.slice(0, 1200));
  } else {
    console.log(s);
  }
}

if (wanted && !found) console.error(`Cle introuvable : ${wanted}`);
