import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

// Serve the ONNX runtime from our own origin (see scripts/copy-ort.mjs).
const base = new URL(import.meta.env.BASE_URL + 'ort/v4/', self.location.origin).href;
env.backends.onnx.wasm!.wasmPaths = {
  mjs: base + 'ort-wasm-simd-threaded.asyncify.mjs',
  wasm: base + 'ort-wasm-simd-threaded.asyncify.wasm',
};

const MODEL = 'onnx-community/whisper-small.en';
let asr: AutomaticSpeechRecognitionPipeline | null = null;

// Whisper tends to "hear" these on silence or noise.
const HALLUCINATIONS = /^(thank you\.?|thanks for watching!?|you|bye\.?|\.+|\[.*\]|\(.*\))$/i;

self.onmessage = async (e: MessageEvent) => {
  const { type, id } = e.data;
  try {
    if (type === 'load') {
      const gpu = 'gpu' in navigator && !!(await (navigator as any).gpu.requestAdapter());
      const files = new Map<string, { loaded: number; total: number }>();
      asr = (await pipeline('automatic-speech-recognition', MODEL, {
        device: gpu ? 'webgpu' : 'wasm',
        dtype: gpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
        progress_callback: (p: any) => {
          if (p.status !== 'progress' || !p.total) return;
          files.set(p.file, { loaded: p.loaded, total: p.total });
          let l = 0, t = 0;
          for (const f of files.values()) { l += f.loaded; t += f.total; }
          self.postMessage({ type: 'progress', progress: l / t });
        },
      })) as AutomaticSpeechRecognitionPipeline;
      await asr(new Float32Array(16000)); // warm-up compiles GPU shaders
      self.postMessage({ type: 'ready', device: gpu ? 'webgpu' : 'wasm' });
    } else if (type === 'transcribe') {
      if (!asr) throw new Error('STT not loaded');
      const out = (await asr(e.data.audio as Float32Array)) as { text: string };
      const text = out.text.trim();
      self.postMessage({ type: 'result', id, text: HALLUCINATIONS.test(text) ? '' : text });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, error: String((err as Error)?.message ?? err) });
  }
};
