// Round animated waveform with a cute face, drawn on a canvas.

export type FaceState = 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'sad';

type RGB = [number, number, number];
const PALETTE: Record<FaceState, [RGB, RGB]> = {
  loading: [[165, 180, 252], [196, 181, 253]],
  idle: [[129, 140, 248], [192, 132, 252]],
  listening: [[52, 211, 153], [34, 211, 238]],
  thinking: [[251, 191, 36], [244, 114, 182]],
  speaking: [[99, 102, 241], [236, 72, 153]],
  happy: [[52, 211, 153], [163, 230, 53]],
  sad: [[251, 113, 133], [249, 168, 212]],
};

const N = 120; // points on the waveform ring

export class Face {
  state: FaceState = 'idle';
  progress = 0;
  /** returns the current sound source to visualize (mic or speaker) */
  source: () => AnalyserNode | null = () => null;

  private ctx: CanvasRenderingContext2D;
  private freq = new Uint8Array(256);
  private wave = new Uint8Array(512);
  private bars = new Float32Array(N);
  private level = 0;
  private colA: RGB = [...PALETTE.idle[0]];
  private colB: RGB = [...PALETTE.idle[1]];
  private blink = 0;
  private nextBlink = performance.now() + 2500;
  private look = { x: 0, y: 0 };
  private pointer = { x: 0, y: 0 };
  private mood = 0; // -1 sad … 1 happy, eased
  private mouthOpen = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    window.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.pointer.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 1.5)));
      this.pointer.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height * 1.5)));
    });
    const loop = (t: number) => { this.draw(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  set(state: FaceState) { this.state = state; }

  private resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private sample() {
    const an = this.source();
    const s = this.state;
    const active = an && (s === 'listening' || s === 'speaking');
    let lvl = 0;
    if (active) {
      an.getByteFrequencyData(this.freq);
      an.getByteTimeDomainData(this.wave);
      let sum = 0;
      for (let i = 0; i < this.wave.length; i++) { const v = (this.wave[i] - 128) / 128; sum += v * v; }
      lvl = Math.min(1, Math.sqrt(sum / this.wave.length) * 4.5);
    }
    this.level += (lvl - this.level) * (lvl > this.level ? 0.5 : 0.15);
    const half = N / 2;
    for (let i = 0; i < N; i++) {
      // mirror so the ring is symmetric left/right; low frequencies at the top
      const k = i < half ? i : N - 1 - i;
      const bin = 2 + Math.floor((k / half) * 70);
      const target = active ? Math.pow(this.freq[bin] / 255, 1.6) : 0;
      this.bars[i] += (target - this.bars[i]) * (target > this.bars[i] ? 0.45 : 0.12);
    }
  }

  private draw(now: number) {
    const t = now / 1000;
    const { width: w, height: h } = this.canvas.getBoundingClientRect();
    const c = this.ctx;
    c.clearRect(0, 0, w, h);
    this.sample();

    const [ta, tb] = PALETTE[this.state];
    for (let i = 0; i < 3; i++) {
      this.colA[i] += (ta[i] - this.colA[i]) * 0.06;
      this.colB[i] += (tb[i] - this.colB[i]) * 0.06;
    }
    const A = (a: number) => `rgba(${this.colA.map(Math.round).join(',')},${a})`;
    const B = (a: number) => `rgba(${this.colB.map(Math.round).join(',')},${a})`;

    const cx = w / 2, cy = h / 2;
    const breathe = Math.sin(t * 1.6) * 0.012;
    const R = Math.min(w, h) * 0.28 * (1 + breathe + this.level * 0.06);

    // glow
    const glow = c.createRadialGradient(cx, cy, R * 0.6, cx, cy, Math.min(w, h) / 2);
    glow.addColorStop(0, A(0.35 + this.level * 0.3));
    glow.addColorStop(1, B(0));
    c.fillStyle = glow;
    c.fillRect(0, 0, w, h);

    // waveform rings
    for (let layer = 0; layer < 3; layer++) {
      const pts: [number, number][] = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 - Math.PI / 2;
        const idle = Math.sin(a * 3 + t * (1.2 + layer * 0.4) + layer) * 0.018 + Math.sin(a * 5 - t * 0.9) * 0.012;
        const think = this.state === 'thinking' ? Math.sin(a * 2 - t * 4) * 0.035 : 0;
        const amp = this.bars[(i + layer * 7) % N] * (0.5 - layer * 0.1);
        const r = R * (1.1 + layer * 0.05 + idle + think + amp);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      c.beginPath();
      smoothClosed(c, pts);
      const g = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      g.addColorStop(0, A(0.5 - layer * 0.14));
      g.addColorStop(1, B(0.5 - layer * 0.14));
      c.strokeStyle = g;
      c.lineWidth = 2.2 - layer * 0.5;
      c.stroke();
      if (layer === 0) { c.fillStyle = A(0.1); c.fill(); }
    }

    // loading progress arc
    if (this.state === 'loading') {
      c.beginPath();
      c.arc(cx, cy, R * 1.32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.01, this.progress));
      c.strokeStyle = B(0.9);
      c.lineWidth = 4;
      c.lineCap = 'round';
      c.stroke();
    }

    // thinking orbit dots
    if (this.state === 'thinking') {
      for (let i = 0; i < 3; i++) {
        const a = t * 2.4 + (i * Math.PI * 2) / 3;
        c.beginPath();
        c.arc(cx + Math.cos(a) * R * 1.3, cy + Math.sin(a) * R * 1.3, R * 0.045, 0, Math.PI * 2);
        c.fillStyle = B(0.9);
        c.fill();
      }
    }

    // body
    const body = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    body.addColorStop(0, A(1));
    body.addColorStop(1, B(1));
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.fillStyle = body;
    c.fill();
    const shine = c.createRadialGradient(cx - R * 0.35, cy - R * 0.45, 0, cx - R * 0.35, cy - R * 0.45, R * 0.9);
    shine.addColorStop(0, 'rgba(255,255,255,0.55)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = shine;
    c.fill();

    this.drawFace(c, cx, cy, R, t, now);
  }

  private drawFace(c: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number, now: number) {
    const s = this.state;
    const ink = 'rgba(30,27,75,0.92)';

    // blink
    if (now > this.nextBlink) { this.blink = 1; this.nextBlink = now + 2200 + Math.random() * 3500; }
    this.blink = Math.max(0, this.blink - 0.12);
    const lid = this.blink > 0 ? Math.abs(Math.cos(this.blink * Math.PI)) : 1;

    // gaze
    let gx = this.pointer.x * 0.6, gy = this.pointer.y * 0.5;
    if (s === 'thinking') { gx = 0.55 + Math.sin(t * 1.3) * 0.15; gy = -0.7; }
    if (s === 'listening') { gx *= 0.3; gy = 0.1; }
    this.look.x += (gx - this.look.x) * 0.08;
    this.look.y += (gy - this.look.y) * 0.08;

    const targetMood = s === 'happy' ? 1 : s === 'sad' ? -1 : 0;
    this.mood += (targetMood - this.mood) * 0.1;
    const openTarget = s === 'speaking' ? Math.min(1, this.level * 1.6) : s === 'listening' ? 0.25 + this.level * 0.3 : 0;
    this.mouthOpen += (openTarget - this.mouthOpen) * 0.35;

    const ex = R * 0.3, ey = cy - R * 0.1 + this.look.y * R * 0.05;
    const ew = R * 0.11, eh = R * 0.16;

    // cheeks
    c.fillStyle = `rgba(255,120,160,${0.28 + Math.max(0, this.mood) * 0.2})`;
    for (const side of [-1, 1]) {
      c.beginPath();
      c.ellipse(cx + side * R * 0.52, cy + R * 0.14, R * 0.13, R * 0.08, 0, 0, Math.PI * 2);
      c.fill();
    }

    // eyes
    for (const side of [-1, 1]) {
      const x = cx + side * ex + this.look.x * R * 0.07;
      if (this.mood > 0.5) {
        // happy ^ ^
        c.beginPath();
        c.arc(x, ey + eh * 0.25, ew * 1.05, Math.PI * 1.1, Math.PI * 1.9);
        c.strokeStyle = ink;
        c.lineWidth = R * 0.055;
        c.lineCap = 'round';
        c.stroke();
        continue;
      }
      c.beginPath();
      c.ellipse(x, ey, ew, Math.max(eh * lid, R * 0.012), 0, 0, Math.PI * 2);
      c.fillStyle = ink;
      c.fill();
      if (lid > 0.5) {
        c.beginPath();
        c.arc(x - ew * 0.3 + this.look.x * ew * 0.2, ey - eh * 0.35, ew * 0.32, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,255,255,0.95)';
        c.fill();
      }
      if (this.mood < -0.4) {
        // worried brows
        c.beginPath();
        c.moveTo(x - side * ew * 1.1, ey - eh * 1.6); // inner end raised = worried, not angry
        c.lineTo(x + side * ew * 0.9, ey - eh * 1.3);
        c.strokeStyle = ink;
        c.lineWidth = R * 0.035;
        c.lineCap = 'round';
        c.stroke();
      }
    }

    // mouth
    const my = cy + R * 0.3;
    c.strokeStyle = ink;
    c.fillStyle = ink;
    c.lineCap = 'round';
    c.lineWidth = R * 0.045;
    if (this.mouthOpen > 0.06) {
      const mw = R * (0.13 + this.mouthOpen * 0.05), mh = R * (0.03 + this.mouthOpen * 0.15);
      c.beginPath();
      c.ellipse(cx, my, mw, mh, 0, 0, Math.PI * 2);
      c.fill();
      c.save();
      c.clip();
      c.beginPath();
      c.ellipse(cx, my + mh * 0.8, mw * 0.7, mh * 0.6, 0, 0, Math.PI * 2);
      c.fillStyle = 'rgba(244,114,182,0.9)';
      c.fill();
      c.restore();
    } else if (s === 'thinking') {
      c.beginPath();
      c.moveTo(cx - R * 0.08, my + R * 0.02);
      c.quadraticCurveTo(cx + R * 0.02, my - R * 0.01 + Math.sin(t * 3) * R * 0.01, cx + R * 0.12, my - R * 0.02);
      c.stroke();
    } else {
      const smile = 0.08 + this.mood * 0.14;
      const mw = R * (0.14 + Math.max(0, this.mood) * 0.06);
      c.beginPath();
      c.moveTo(cx - mw, my - R * smile * 0.3);
      c.quadraticCurveTo(cx, my + R * smile * 1.4, cx + mw, my - R * smile * 0.3);
      if (this.mood > 0.5) { c.closePath(); c.fill(); } else c.stroke();
    }
  }
}

function smoothClosed(c: CanvasRenderingContext2D, p: [number, number][]) {
  const n = p.length;
  const mid = (i: number) => [(p[i][0] + p[(i + 1) % n][0]) / 2, (p[i][1] + p[(i + 1) % n][1]) / 2];
  const [sx, sy] = mid(n - 1);
  c.moveTo(sx, sy);
  for (let i = 0; i < n; i++) {
    const [mx, my] = mid(i);
    c.quadraticCurveTo(p[i][0], p[i][1], mx, my);
  }
  c.closePath();
}
