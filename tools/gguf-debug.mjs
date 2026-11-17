// Debug : liste les cles GGUF avec offset et type, sans lire les valeurs longues.
import { readFileSync } from "node:fs";

const file = process.argv[2];
const buf = readFileSync(file);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let off = 4;

function u32() { const v = dv.getUint32(off, true); off += 4; return v; }
function u64() { const v = dv.getBigUint64(off, true); off += 8; return Number(v); }
function str() {
  const len = u64();
  const s = new TextDecoder().decode(buf.subarray(off, off + len));
  off += len;
  return s;
}
function elemSize(t) {
  switch (t) {
    case 0: case 1: case 7: return 1;
    case 2: case 3: return 2;
    case 4: case 5: case 6: return 4;
    case 10: case 11: case 12: return 8;
    default: return 0;
  }
}

const version = u32();
const nTensors = u64();
const kvCount = u64();
console.log(`version=${version} n_tensors=${nTensors} kv=${kvCount} bufLen=${buf.length}`);

for (let i = 0; i < kvCount; i++) {
  const start = off;
  const key = str();
  const type = u32();
  let info = "";
  if (type === 9) {
    const n = u64();
    const t = u32();
    info = `array n=${n} type=${t}`;
    if (t === 8) {
      for (let k = 0; k < n; k++) str();
    } else {
      const sz = elemSize(t);
      if (!sz) throw new Error(`array non gere type ${t}`);
      off += n * sz;
    }
  } else if (type === 8) {
    const s = str();
    info = `str len=${s.length}`;
  } else {
    const sz = elemSize(type);
    if (!sz) throw new Error(`type non gere ${type}`);
    off += sz;
    info = `scalar type=${type}`;
  }
  console.log(`${i} @${start} ${key} [${info}] -> off=${off}`);
}
console.log(`fin off=${off}`);
