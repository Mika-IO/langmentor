import { KokoroTTS, env } from 'kokoro-js';

// Serve the ONNX runtime from our own origin (see scripts/copy-ort.mjs).
env.wasmPaths = new URL(import.meta.env.BASE_URL + 'ort/v3/', self.location.origin).href;

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let tts: KokoroTTS | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, id } = e.data;
  try {
    if (type === 'load') {
      const gpu = 'gpu' in navigator && !!(await (navigator as any).gpu.requestAdapter());
      const files = new Map<string, { loaded: number; total: number }>();
      tts = await KokoroTTS.from_pretrained(MODEL, {
        dtype: gpu ? 'fp32' : 'q8',
        device: gpu ? 'webgpu' : 'wasm',
        progress_callback: (p: any) => {
          if (p.status !== 'progress' || !p.total) return;
          files.set(p.file, { loaded: p.loaded, total: p.total });
          let l = 0, t = 0;
          for (const f of files.values()) { l += f.loaded; t += f.total; }
          self.postMessage({ type: 'progress', progress: l / t });
        },
      });
      await tts.generate('Hi.', { voice: 'af_heart' }); // warm-up
      self.postMessage({ type: 'ready', device: gpu ? 'webgpu' : 'wasm' });
    } else if (type === 'speak') {
      if (!tts) throw new Error('TTS not loaded');
      const raw = await tts.generate(e.data.text, { voice: e.data.voice, speed: e.data.speed });
      const audio = raw.audio as Float32Array;
      self.postMessage({ type: 'result', id, audio, sampleRate: raw.sampling_rate }, { transfer: [audio.buffer] });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, error: String((err as Error)?.message ?? err) });
  }
};
