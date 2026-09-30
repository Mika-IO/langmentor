// Microphone capture with a lightweight energy-based VAD, and a gapless audio player.
// Both expose an AnalyserNode so the face can react to sound.

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('tap', Tap);
`;

export interface RecordOptions {
  /** ms of silence after speech that ends the take */
  silenceMs?: number;
  /** give up if nobody speaks within this many ms */
  noSpeechMs?: number;
  maxMs?: number;
  onSpeechStart?: () => void;
}

export class Mic {
  /** Rate handed to Whisper. Capture runs at the context's native rate and is resampled at the end. */
  readonly sampleRate = 16000;
  analyser: AnalyserNode | null = null;
  private finish: (() => void) | null = null;
  private cancelled = false;
  private worklet: Promise<void> | null = null;

  /**
   * Uses a context that was resumed during a user gesture (the player's). A context created later,
   * e.g. in hands-free mode after the tutor finishes speaking, would stay suspended forever.
   */
  constructor(private ctx: AudioContext) {}

  get active() { return this.finish !== null; }

  /** Ask for mic permission up front (call from a click) so the prompt doesn't interrupt a lesson. */
  async warmup() {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    await this.loadWorklet();
  }

  private loadWorklet() {
    return (this.worklet ??= this.ctx.audioWorklet.addModule(
      URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })),
    ));
  }

  /** Records until the speaker goes quiet (or stop() is called). Resolves with 16 kHz mono PCM, empty if no speech. */
  async record(opts: RecordOptions = {}): Promise<Float32Array> {
    const { silenceMs = 1200, noSpeechMs = 8000, maxMs = 30000, onSpeechStart } = opts;
    this.cancelled = false;
    this.finish = () => { this.cancelled = true; }; // lets stop() abort while we are still setting up
    const ctx = this.ctx;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (ctx.state !== 'running') await ctx.resume();
      await this.loadWorklet();
    } catch (e) {
      this.finish = null;
      throw e;
    }
    if (this.cancelled) {
      stream.getTracks().forEach((t) => t.stop());
      this.finish = null;
      return new Float32Array(0);
    }

    const rate = ctx.sampleRate;
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'tap');
    const sink = ctx.createGain(); // keeps the worklet pulled by the graph, silently
    sink.gain.value = 0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    src.connect(analyser);
    src.connect(node);
    node.connect(sink).connect(ctx.destination);
    this.analyser = analyser;

    const chunks: Float32Array[] = [];
    const preroll: Float32Array[] = [];
    let prerollLen = 0;
    let heardSpeech = false;
    let noise = 0.003, silentFor = 0, elapsed = 0, voicedMs = 0;
    // VAD decisions are made on ~30 ms windows, not on single 128-sample frames
    const win = Math.round(rate * 0.03);
    let winSum = 0, winN = 0;

    return new Promise<Float32Array>((resolve) => {
      const done = async () => {
        if (this.finish !== done) return;
        this.finish = null;
        node.port.onmessage = null;
        src.disconnect(); node.disconnect(); sink.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        this.analyser = null;
        if (!heardSpeech) return resolve(new Float32Array(0));
        const all = [...preroll, ...chunks];
        const pcm = new Float32Array(all.reduce((n, c) => n + c.length, 0));
        let o = 0;
        for (const c of all) { pcm.set(c, o); o += c.length; }
        resolve(await resample(pcm, rate, this.sampleRate));
      };
      this.finish = done;

      node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
        const buf = ev.data;
        if (heardSpeech) chunks.push(buf);
        else {
          preroll.push(buf); // keep ~400 ms before speech onset
          prerollLen += buf.length;
          while (prerollLen - preroll[0].length > rate * 0.4) prerollLen -= preroll.shift()!.length;
        }
        for (let i = 0; i < buf.length; i++) winSum += buf[i] * buf[i];
        winN += buf.length;
        if (winN < win) return;

        const ms = (winN / rate) * 1000;
        const rms = Math.sqrt(winSum / winN);
        winSum = winN = 0;
        elapsed += ms;
        const loud = rms > Math.max(0.006, noise * 2.5);
        if (!loud) noise = noise * 0.95 + rms * 0.05; // adapt noise floor

        if (!heardSpeech) {
          voicedMs = loud ? voicedMs + ms : 0;
          if (voicedMs >= 90) { heardSpeech = true; onSpeechStart?.(); } // ignore clicks
          else if (elapsed > noSpeechMs) done();
          return;
        }
        if (loud) silentFor = 0;
        else if ((silentFor += ms) > silenceMs) done();
        if (elapsed > maxMs) done();
      };
    });
  }

  stop() { this.finish?.(); }
}

async function resample(pcm: Float32Array, from: number, to: number): Promise<Float32Array> {
  if (from === to || !pcm.length) return pcm;
  const off = new OfflineAudioContext(1, Math.ceil((pcm.length * to) / from), to);
  const buf = off.createBuffer(1, pcm.length, from);
  buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

export class Player {
  readonly ctx = new AudioContext();
  readonly analyser: AnalyserNode;
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private idleWaiters: (() => void)[] = [];

  constructor() {
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.5;
    this.analyser.connect(this.ctx.destination);
  }

  get playing() { return this.sources.size > 0; }

  async unlock() { if (this.ctx.state !== 'running') await this.ctx.resume(); }

  enqueue(samples: Float32Array, sampleRate: number) {
    if (!samples.length) return;
    const buf = this.ctx.createBuffer(1, samples.length, sampleRate);
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    const at = Math.max(this.ctx.currentTime + 0.02, this.next);
    src.start(at);
    this.next = at + buf.duration + 0.08; // small breath between sentences
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size) this.flushIdle();
    };
  }

  /** Resolves once everything queued so far has finished playing. */
  waitIdle(): Promise<void> {
    if (!this.sources.size) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  stop() {
    for (const s of this.sources) { s.onended = null; try { s.stop(); } catch {} }
    this.sources.clear();
    this.next = 0;
    this.flushIdle();
  }

  private flushIdle() {
    const w = this.idleWaiters;
    this.idleWaiters = [];
    w.forEach((f) => f());
  }
}
