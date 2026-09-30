// Copies ONNX Runtime WASM binaries into public/ so speech models run fully offline
// (transformers.js would otherwise fetch them from a CDN).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const jobs = [
  // Whisper (transformers.js v4)
  { from: 'node_modules/onnxruntime-web/dist', to: 'public/ort/v4', files: ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'] },
  // Kokoro (bundles transformers.js v3)
  { from: 'node_modules/kokoro-js/node_modules/onnxruntime-web/dist', to: 'public/ort/v3', files: ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'] },
];

for (const { from, to, files } of jobs) {
  mkdirSync(to, { recursive: true });
  for (const f of files) {
    const src = join(from, f);
    if (!existsSync(src)) { console.warn(`[copy-ort] missing ${src}`); continue; }
    copyFileSync(src, join(to, f));
  }
}
console.log('[copy-ort] done');
