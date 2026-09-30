import type { Player } from './audio';

type Progress = (p: number) => void;

/** Minimal request/response wrapper around a model worker. */
class WorkerClient {
  private w: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private onProgress: Progress = () => {};
  private onReady: (() => void) | null = null;
  private onLoadError: ((e: Error) => void) | null = null;
  device = '';

  constructor(worker: Worker) {
    this.w = worker;
    this.w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress') this.onProgress(d.progress);
      else if (d.type === 'ready') { this.device = d.device; this.onReady?.(); }
      else if (d.type === 'result') { this.pending.get(d.id)?.resolve(d); this.pending.delete(d.id); }
      else if (d.type === 'error') {
        const err = new Error(d.error);
        if (d.id == null) this.onLoadError?.(err);
        else { this.pending.get(d.id)?.reject(err); this.pending.delete(d.id); }
      }
    };
  }

  load(onProgress: Progress): Promise<void> {
    this.onProgress = onProgress;
    return new Promise((resolve, reject) => {
      this.onReady = resolve;
      this.onLoadError = reject;
      this.w.postMessage({ type: 'load' });
    });
  }

  call(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.w.postMessage({ ...msg, id }, transfer);
    });
  }
}

export class Ears {
  private c = new WorkerClient(new Worker(new URL('./workers/stt.worker.ts', import.meta.url), { type: 'module' }));
  load(p: Progress) { return this.c.load(p); }
  async transcribe(audio: Float32Array): Promise<string> {
    if (audio.length < 16000 * 0.3) return '';
    const r = await this.c.call({ type: 'transcribe', audio }, [audio.buffer]);
    return r.text as string;
  }
}

export interface VoiceSettings { voice: string; speed: number }

/**
 * Text-to-speech with a sentence queue: synthesis of sentence N+1 overlaps playback of N.
 * `interrupt()` drops anything still queued.
 */
export class Mouth {
  private c = new WorkerClient(new Worker(new URL('./workers/tts.worker.ts', import.meta.url), { type: 'module' }));
  private chain: Promise<void> = Promise.resolve();
  private gen = 0;
  ok = false;

  constructor(private player: Player, private settings: () => VoiceSettings) {}

  async load(p: Progress) {
    try { await this.c.load(p); this.ok = true; }
    catch (e) { console.warn('Kokoro failed, falling back to system voice', e); p(1); }
  }

  /** Queue a sentence for speaking. */
  say(text: string, speedMul = 1) {
    text = text.trim();
    if (!text) return;
    const gen = this.gen;
    const { voice, speed } = this.settings();
    if (!this.ok) {
      this.chain = this.chain.then(() => (gen === this.gen ? systemSpeak(text, speed * speedMul) : undefined));
      return;
    }
    const audio = this.c.call({ type: 'speak', text, voice, speed: speed * speedMul }).catch(() => null);
    this.chain = this.chain.then(async () => {
      const r = await audio;
      if (r && gen === this.gen) this.player.enqueue(r.audio, r.sampleRate);
    });
  }

  /** Resolves when everything queued so far has been spoken. */
  async done() {
    let c: Promise<void>;
    do { c = this.chain; await c; } while (c !== this.chain);
    await this.player.waitIdle();
  }

  async speak(text: string, speedMul = 1) {
    for (const s of splitSentences(text)) this.say(s, speedMul);
    await this.done();
  }

  interrupt() {
    this.gen++;
    this.player.stop();
    speechSynthesis?.cancel();
  }
}

function systemSpeak(text: string, rate: number): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    const local = speechSynthesis.getVoices().find((v) => v.lang.startsWith('en') && v.localService);
    if (local) u.voice = local;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}
