import { Mic, Player } from './audio';
import { Face, type FaceState } from './face';
import { Brain, MODELS, partialString, type Msg } from './llm';
import { Ears, Mouth } from './speech';
import {
  compareWords, listenPrompt, listenSchema, readPrompt, readSchema, talkOpenerHints, talkOpeners, talkSchema,
  talkSystem, writeReviewPrompt, writeReviewSchema, writeTaskPrompt, writeTaskSchema,
  type Lang, type Level, type ListenTask, type ReadTask, type TalkTurn, type WriteReview, type WriteTask,
} from './lessons';

// ─── settings ──────────────────────────────────────────────────────────────

type Mode = 'talk' | 'read' | 'write' | 'listen';
interface Settings { level: Level; lang: Lang; voice: string; speed: number; model: string; handsFree: boolean; mode: Mode }

const DEFAULTS: Settings = { level: 'A2', lang: 'pt', voice: 'af_heart', speed: 0.9, model: MODELS[0].id, handsFree: true, mode: 'talk' };
const settings: Settings = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('langmentor') ?? '{}') }; } catch { return { ...DEFAULTS }; }
})();
const save = () => { try { localStorage.setItem('langmentor', JSON.stringify(settings)); } catch {} };

// ─── engines ───────────────────────────────────────────────────────────────

const player = new Player();
const mic = new Mic(player.ctx);
const brain = new Brain();
const ears = new Ears();
const mouth = new Mouth(player, () => ({ voice: settings.voice, speed: settings.speed }));
const face = new Face(document.querySelector<HTMLCanvasElement>('#face')!);
face.source = () => (face.state === 'listening' ? mic.analyser : player.analyser);
face.set('loading');

// ─── dom helpers ───────────────────────────────────────────────────────────

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const panel = $('#panel'), dock = $('#dock'), statusEl = $('#status'), orb = $('#orb');

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k) el.append(k);
  return el;
}

const setStatus = (s: string) => { statusEl.textContent = s; };
const show = (...kids: Child[]) => {
  panel.replaceChildren(...(kids.filter(Boolean) as Node[]));
  panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = '';
};
const speakIcon = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = '<path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 010 6M19 6a8 8 0 010 12"/>';
  return s;
};
const sendIcon = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = '<path d="M5 12h14M13 6l6 6-6 6"/>';
  return s;
};
const skeleton = () => h('div', { class: 'card' }, h('div', { class: 'skeleton', style: 'width:80%' }), h('div', { class: 'skeleton', style: 'width:60%;margin-top:10px' }));

function composer(placeholder: string, onSend: (text: string) => void, multiline = false) {
  const field = multiline
    ? h('textarea', { rows: 2, placeholder })
    : h('input', { type: 'text', placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const btn = h('button', { 'aria-label': 'Send', disabled: true }, sendIcon());
  const send = () => { const v = field.value.trim(); if (!v) return; field.value = ''; btn.disabled = true; onSend(v); };
  field.addEventListener('input', () => {
    btn.disabled = !field.value.trim();
    if (multiline) { field.style.height = 'auto'; field.style.height = field.scrollHeight + 'px'; }
  });
  field.addEventListener('keydown', (e: Event) => {
    const k = e as KeyboardEvent;
    if (k.key === 'Enter' && !k.shiftKey && !k.isComposing) { k.preventDefault(); send(); }
  });
  btn.addEventListener('click', send);
  dock.replaceChildren(h('div', { class: 'composer' }, field, btn));
  return field;
}

function scoreView(score: number, caption: string) {
  const cls = score >= 80 ? 'good' : score >= 50 ? 'mid' : 'low';
  return h('div', { class: `score ${cls}` }, h('strong', {}, String(score)), h('span', {}, caption));
}

function mood(score: number) { react(score >= 80 ? 'happy' : score < 50 ? 'sad' : 'idle'); }
function react(state: FaceState, ms = 2200) {
  face.set(state);
  if (state === 'happy' || state === 'sad') setTimeout(() => { if (face.state === state) face.set('idle'); }, ms);
}

function choices(options: string[], answer: number, onDone: (right: boolean) => void) {
  const btns = options.map((o, i) =>
    h('button', { class: 'opt', onclick: () => pick(i) }, h('b', {}, 'ABCD'[i]), o),
  );
  function pick(i: number) {
    btns.forEach((b, j) => { b.disabled = true; if (j === answer) b.classList.add('right'); });
    if (i !== answer) btns[i].classList.add('wrong');
    react(i === answer ? 'happy' : 'sad');
    onDone(i === answer);
  }
  return h('div', { class: 'options' }, ...btns);
}

// ─── flow control ──────────────────────────────────────────────────────────

let mode: Mode = settings.mode;
let epoch = 0; // bumps on every mode switch; stale async flows check it and bail
const alive = (e: number) => e === epoch;

function cancelAll() {
  epoch++;
  brain.interrupt();
  mouth.interrupt();
  mic.stop();
}

function fail(e: number, err: unknown, retry: () => void) {
  if (!alive(e)) return;
  console.error(err);
  face.set('sad');
  setStatus('');
  show(h('p', { class: 'error' }, 'Oops, something went wrong.'), h('div', { class: 'row-btns' }, h('button', { class: 'ghost', onclick: retry }, 'Try again')));
}

async function speak(text: string, speed = 1) {
  const e = epoch;
  face.set('speaking');
  await mouth.speak(text, speed);
  if (alive(e) && face.state === 'speaking') face.set('idle');
}

/** Listen until the learner stops talking, then transcribe. Returns '' if nothing was heard. */
async function hear(): Promise<string> {
  const e = epoch;
  mouth.interrupt();
  await player.unlock();
  face.set('listening');
  setStatus('Listening…');
  let audio: Float32Array;
  try { audio = await mic.record(); }
  catch (err) {
    console.error(err);
    face.set('sad');
    const name = (err as DOMException)?.name;
    setStatus(name === 'NotFoundError' ? 'No microphone found.' : name === 'NotAllowedError' ? 'Microphone blocked — allow it in the browser (🔒 in the address bar).' : `Microphone error: ${(err as Error)?.message ?? err}`);
    return '';
  }
  if (!alive(e)) return '';
  if (!audio.length) { face.set('idle'); return ''; }
  face.set('thinking');
  setStatus('');
  const text = await ears.transcribe(audio);
  return alive(e) ? text : '';
}

const modeStart: Record<Mode, () => void> = { talk: startTalk, read: newRead, write: newWrite, listen: newListen };
let orbAction: () => void = () => {};

function setMode(m: Mode) {
  cancelAll();
  mode = settings.mode = m;
  save();
  document.querySelectorAll<HTMLButtonElement>('.modes button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  dock.replaceChildren();
  face.set('idle');
  setStatus('');
  orbAction = () => {};
  modeStart[m]();
}

// ─── Talk ──────────────────────────────────────────────────────────────────

// Assistant turns hold the raw JSON the model produced, so WebLLM can reuse its KV cache between turns.
const history: Msg[] = [];
let lastReply = '';

function trimHistory() {
  const size = () => history.reduce((n, m) => n + String(m.content).length, 0);
  if (size() < 7000) return; // ~1.8k tokens; context window is 4k
  while (history.length > 6) history.shift();
  if (history[0].role === 'assistant') history.shift();
}

function startTalk() {
  composer('Type instead…', (t) => talkTurn(t));
  orbAction = () => {
    if (face.state === 'listening') return mic.stop();
    if (face.state === 'thinking') return;
    talkListen();
  };
  if (!history.length) {
    const hello = talkOpeners[settings.level];
    history.push({ role: 'assistant', content: hello });
    lastReply = hello;
    renderTalk({ reply: hello, hints: talkOpenerHints[settings.level] });
    talkSpeakThenListen(hello);
  } else {
    renderTalk({ reply: lastReply });
    setStatus('Tap me to talk');
  }
}

function renderTalk(p: { you?: string; reply?: string; turn?: TalkTurn; hints?: string[] }) {
  const replyEl = h('p', { class: 'say' }, p.reply ?? '');
  const fix = p.turn;
  const needsFix = fix && fix.has_mistake && fix.corrected && norm(fix.corrected) !== norm(p.you ?? '');
  const hints = p.turn?.hints ?? p.hints ?? [];
  show(
    p.you ? h('p', { class: 'you' }, p.you) : null,
    replyEl,
    needsFix
      ? h('div', { class: 'card fix', title: 'Tap to hear', onclick: () => speak(fix.corrected) },
          h('p', { class: 'label' }, 'Better'), h('div', { class: 'better' }, fix.corrected), fix.explanation && h('div', { class: 'why' }, fix.explanation))
      : null,
    hints.length
      ? h('div', {}, h('p', { class: 'label', style: 'text-align:center' }, 'You could say'),
          h('div', { class: 'chips' }, ...hints.map(unquote).map((t) => h('button', { class: 'chip quiet', onclick: () => speak(t) }, speakIcon(), t))))
      : null,
  );
  return replyEl;
}

const unquote = (s: string) => s.trim().replace(/^["“']+|["”']+$/g, '');
const norm = (s: string) => s.toLowerCase().replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim();

async function talkSpeakThenListen(text: string) {
  const e = epoch;
  await speak(text);
  if (!alive(e)) return;
  if (settings.handsFree) talkListen();
  else setStatus('Tap me to talk');
}

async function talkListen() {
  const e = epoch;
  const text = await hear();
  if (!alive(e)) return;
  if (!text) { face.set('idle'); setStatus('Tap me to talk'); return; }
  talkTurn(text);
}

async function talkTurn(you: string) {
  cancelAll();
  const e = epoch;
  trimHistory();
  history.push({ role: 'user', content: you });
  const replyEl = renderTalk({ you });
  face.set('thinking');
  setStatus('');
  let spoken = 0;
  try {
    const { data: turn, raw } = await brain.jsonRaw<TalkTurn>(
      [{ role: 'system', content: talkSystem(settings.level, settings.lang) }, ...history],
      talkSchema,
      {
        onText: (raw) => {
          if (!alive(e)) return;
          const p = partialString(raw, 'reply');
          if (!p) return;
          replyEl.textContent = p.value;
          // hand complete sentences to the voice while the model keeps writing
          let cut = spoken;
          const re = /[.!?]+["')\]]*\s+/g;
          re.lastIndex = spoken;
          for (let m; (m = re.exec(p.value)); ) cut = m.index + m[0].length;
          if (p.closed) cut = p.value.length;
          if (cut > spoken) {
            mouth.say(p.value.slice(spoken, cut));
            spoken = cut;
            face.set('speaking');
          }
        },
      },
    );
    if (!alive(e)) return;
    if (spoken < turn.reply.length) mouth.say(turn.reply.slice(spoken));
    history.push({ role: 'assistant', content: raw });
    lastReply = turn.reply;
    renderTalk({ you, reply: turn.reply, turn });
    face.set('speaking');
    await mouth.done();
    if (!alive(e)) return;
    face.set('idle');
    if (settings.handsFree) talkListen();
    else setStatus('Tap me to talk');
  } catch (err) {
    history.pop();
    fail(e, err, () => talkTurn(you));
  }
}

// ─── Read ──────────────────────────────────────────────────────────────────

async function newRead() {
  const e = epoch;
  face.set('thinking');
  setStatus('Writing something for you to read…');
  show(skeleton());
  orbAction = () => {};
  try {
    const task = await brain.json<ReadTask>(readPrompt(settings.level), readSchema, { temperature: 0.9 });
    if (!alive(e)) return;
    showRead(task);
  } catch (err) { fail(e, err, newRead); }
}

function showRead(task: ReadTask) {
  const e = epoch;
  const words = task.passage.split(/\s+/).filter(Boolean);
  const spans = words.map((w) => h('span', { class: 'w', title: 'Tap to hear', onclick: () => speak(w.replace(/[^\w']/g, ''), 0.85) }, w));
  const passage = h('p', { class: 'passage' });
  spans.forEach((s, i) => passage.append(s, i < spans.length - 1 ? ' ' : ''));
  const result = h('div', {});
  const quiz = h('div', {});

  const read = async () => {
    if (face.state === 'listening') return mic.stop();
    if (face.state === 'thinking') return;
    const said = await hear();
    if (!alive(e)) return;
    if (!said) { face.set('idle'); setStatus('I didn’t hear you. Tap me and read again.'); return; }
    const r = compareWords(task.passage, said);
    r.words.forEach((w, i) => { spans[i].classList.remove('ok', 'miss'); spans[i].classList.add(w.ok ? 'ok' : 'miss'); });
    const missed = r.words.filter((w) => !w.ok).length;
    result.replaceChildren(
      scoreView(r.score, r.score >= 90 ? 'Excellent reading!' : r.score >= 70 ? 'Nice! Tap red words to hear them.' : 'Keep practicing — tap red words to hear them.'),
      h('p', { class: 'you' }, said),
    );
    mood(r.score);
    setStatus(missed ? 'Tap me to try again' : '');
    if (!quiz.childElementCount) {
      quiz.append(
        h('div', { class: 'card' }, h('p', { class: 'label' }, 'Question'), h('p', { style: 'margin:0 0 10px' }, task.question),
          choices(task.options, task.answer, () => quiz.append(h('div', { class: 'row-btns', style: 'margin-top:12px' }, h('button', { class: 'primary', onclick: () => { cancelAll(); newRead(); } }, 'Next text'))))),
      );
    }
  };
  orbAction = read;

  show(
    h('p', { class: 'title' }, task.title),
    passage,
    h('div', { class: 'row-btns' },
      h('button', { class: 'ghost', onclick: () => speak(task.passage) }, 'Hear it first'),
      h('button', { class: 'primary', onclick: read }, 'Read aloud')),
    result,
    quiz,
  );
  face.set('idle');
  setStatus('Tap me and read it out loud');
}

// ─── Write ─────────────────────────────────────────────────────────────────

let writeCount = 0;

async function newWrite() {
  const e = epoch;
  const kind: WriteTask['kind'] = writeCount++ % 2 ? 'free' : 'translate';
  face.set('thinking');
  setStatus('Preparing a writing task…');
  show(skeleton());
  dock.replaceChildren();
  try {
    const t = await brain.json<{ portuguese?: string; question?: string }>(writeTaskPrompt(settings.level, kind), writeTaskSchema(kind), { temperature: 0.9 });
    if (!alive(e)) return;
    showWrite(kind === 'translate'
      ? { kind, instruction: 'Translate to English', source: t.portuguese ?? '' }
      : { kind, instruction: t.question ?? '', source: '' });
  } catch (err) { fail(e, err, newWrite); }
}

function showWrite(task: WriteTask) {
  const e = epoch;
  const say = task.kind === 'free' ? task.instruction : '';
  orbAction = () => { if (say) speak(say); };
  show(
    h('p', { class: 'title' }, task.kind === 'translate' ? 'Translate to English' : 'Write'),
    h('p', { class: 'say' }, task.kind === 'translate' ? `“${task.source}”` : task.instruction),
  );
  face.set('idle');
  setStatus(task.kind === 'translate' ? 'Write it in English below' : 'Write your answer below');
  const field = composer('Write in English…', (answer) => review(answer), true);
  field.focus();

  async function review(answer: string) {
    face.set('thinking');
    setStatus('Checking…');
    dock.replaceChildren();
    try {
      const r = await brain.json<WriteReview>(writeReviewPrompt(settings.level, settings.lang, task, answer), writeReviewSchema, { temperature: 0.2, maxTokens: 700 });
      if (!alive(e)) return;
      const same = norm(r.corrected) === norm(answer);
      show(
        h('p', { class: 'title' }, task.kind === 'translate' ? 'Translate to English' : 'Write'),
        h('p', { class: 'you', style: 'font-size:16px' }, task.kind === 'translate' ? `“${task.source}”` : task.instruction),
        scoreView(r.score, r.feedback),
        h('div', { class: 'card' },
          h('p', { class: 'label' }, 'You wrote'), h('p', { style: 'margin:0' }, answer),
          !same && h('p', { class: 'label', style: 'margin-top:12px' }, 'Corrected'),
          !same && h('p', { class: 'speakable', style: 'margin:0', onclick: () => speak(r.corrected) }, r.corrected),
          h('p', { class: 'label', style: 'margin-top:12px' }, 'Native speaker'),
          h('p', { class: 'speakable', style: 'margin:0;font-weight:550', title: 'Tap to hear', onclick: () => speak(r.natural) }, r.natural)),
        r.errors.length
          ? h('div', { class: 'card' }, h('p', { class: 'label' }, 'Mistakes'),
              h('ul', { class: 'errors' }, ...r.errors.map((x) => h('li', {}, h('s', {}, x.wrong), ' → ', h('ins', {}, x.right), h('small', {}, x.why)))))
          : null,
        h('div', { class: 'row-btns' }, h('button', { class: 'primary', onclick: () => { cancelAll(); newWrite(); } }, 'Next')),
      );
      mood(r.score);
      setStatus('');
      orbAction = () => speak(r.natural);
    } catch (err) { fail(e, err, () => review(answer)); }
  }
}

// ─── Listen ────────────────────────────────────────────────────────────────

let listenCount = 0;

async function newListen() {
  const e = epoch;
  const kind = listenCount++ % 2 ? 'quiz' : 'dictation';
  face.set('thinking');
  setStatus('Preparing audio…');
  show(skeleton());
  dock.replaceChildren();
  try {
    const t = await brain.json<ListenTask>(listenPrompt(settings.level, kind), listenSchema, { temperature: 0.9 });
    if (!alive(e)) return;
    showListen(t, kind);
  } catch (err) { fail(e, err, newListen); }
}

function showListen(t: ListenTask, kind: 'dictation' | 'quiz') {
  const e = epoch;
  const play = (slow = false) => speak(t.text, slow ? 0.75 : 1);
  orbAction = () => play();
  const next = () => h('div', { class: 'row-btns' }, h('button', { class: 'primary', onclick: () => { cancelAll(); newListen(); } }, 'Next'));
  const controls = h('div', { class: 'row-btns' },
    h('button', { class: 'ghost', onclick: () => play() }, 'Play again'),
    h('button', { class: 'ghost', onclick: () => play(true) }, 'Slower'));

  if (kind === 'dictation') {
    show(h('p', { class: 'title' }, 'Dictation'), h('p', { class: 'say' }, 'Type exactly what you hear.'), controls);
    const field = composer('What did you hear?', (typed) => {
      const r = compareWords(t.text, typed);
      dock.replaceChildren();
      const text = h('p', { class: 'passage' });
      r.words.forEach((w, i) => text.append(h('span', { class: `w ${w.ok ? 'ok' : 'miss'}`, onclick: () => speak(w.text.replace(/[^\w']/g, ''), 0.85) }, w.text), i < r.words.length - 1 ? ' ' : ''));
      show(
        h('p', { class: 'title' }, 'Dictation'),
        scoreView(r.score, r.score === 100 ? 'Perfect!' : r.score >= 80 ? 'Almost perfect!' : 'Listen again and compare.'),
        text,
        h('p', { class: 'you' }, typed),
        controls,
        next(),
      );
      mood(r.score);
    });
    field.focus();
  } else {
    const quiz = h('div', {});
    show(h('p', { class: 'title' }, 'Listen & answer'), h('p', { class: 'say' }, t.question), controls, quiz);
    quiz.append(choices(t.options, t.answer, () => {
      quiz.append(h('div', { class: 'card', style: 'margin-top:12px' }, h('p', { class: 'label' }, 'Transcript'),
        h('p', { class: 'speakable', style: 'margin:0', onclick: () => play() }, t.text)), next());
    }));
  }
  setStatus('Tap me to replay');
  play().then(() => { if (alive(e)) setStatus('Tap me to replay'); });
}

// ─── wiring ────────────────────────────────────────────────────────────────

orb.addEventListener('click', () => { if (booted) orbAction(); });
window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (e.code === 'Space' && booted && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'BUTTON') { e.preventDefault(); orbAction(); }
});
document.querySelectorAll<HTMLButtonElement>('.modes button').forEach((b) =>
  b.addEventListener('click', () => { if (booted) setMode(b.dataset.mode as Mode); }),
);

// settings dialog
const dlg = $<HTMLDialogElement>('#settings');
const levelSeg = $('#set-level');
let pendingLevel = settings.level;
(['A1', 'A2', 'B1', 'B2', 'C1'] as Level[]).forEach((l) =>
  levelSeg.append(h('button', { type: 'button', 'data-l': l, onclick: () => { pendingLevel = l; syncLevel(); } }, l)),
);
const syncLevel = () => levelSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.l === pendingLevel)));
const modelSel = $<HTMLSelectElement>('#set-model');
MODELS.forEach((m) => modelSel.append(h('option', { value: m.id }, m.label)));
const syncNote = () => { $('#model-note').textContent = MODELS.find((m) => m.id === modelSel.value)?.note ?? ''; };
modelSel.addEventListener('change', syncNote);

$('#open-settings').addEventListener('click', () => {
  pendingLevel = settings.level;
  syncLevel();
  $<HTMLSelectElement>('#set-lang').value = settings.lang;
  $<HTMLSelectElement>('#set-voice').value = settings.voice;
  $<HTMLSelectElement>('#set-speed').value = String(settings.speed);
  modelSel.value = settings.model;
  syncNote();
  $<HTMLInputElement>('#set-hands').checked = settings.handsFree;
  dlg.showModal();
});
dlg.addEventListener('close', async () => {
  if (dlg.returnValue !== 'ok') return;
  const levelChanged = pendingLevel !== settings.level;
  const modelChanged = modelSel.value !== settings.model;
  Object.assign(settings, {
    level: pendingLevel,
    lang: $<HTMLSelectElement>('#set-lang').value as Lang,
    voice: $<HTMLSelectElement>('#set-voice').value,
    speed: Number($<HTMLSelectElement>('#set-speed').value),
    model: modelSel.value,
    handsFree: $<HTMLInputElement>('#set-hands').checked,
  });
  save();
  if (levelChanged) history.length = 0;
  if (modelChanged && booted) {
    cancelAll();
    booted = false;
    dock.replaceChildren();
    show();
    face.set('loading');
    try {
      await brain.load(settings.model, (p, text) => { face.progress = p; setStatus(text.split('.')[0]); });
    } catch (err) { console.error(err); setStatus('Could not load that model.'); face.set('sad'); return; }
    booted = true;
    setMode(mode);
  } else if (levelChanged && booted) setMode(mode);
});

// ─── boot ──────────────────────────────────────────────────────────────────

let booted = false;
$('#llm-name').textContent = MODELS.find((m) => m.id === settings.model)?.label ?? settings.model;

$('#start').addEventListener('click', async () => {
  const startBtn = $<HTMLButtonElement>('#start');
  player.unlock(); // must happen inside the click, before any await
  const micReady = mic.warmup().catch((err) => {
    console.error(err);
    $('#boot-hint').textContent = 'Sem acesso ao microfone — libere no cadeado da barra de endereço. Dá pra usar digitando.';
  });
  if (!('gpu' in navigator) || !(await (navigator as any).gpu.requestAdapter().catch(() => null))) {
    $('#boot-hint').textContent = 'Este navegador não tem WebGPU. Use Chrome, Edge ou Safari 26+ atualizado.';
    return;
  }
  startBtn.disabled = true;
  startBtn.textContent = 'Loading…';

  const prog = { llm: 0, stt: 0, tts: 0 };
  const bar = (k: keyof typeof prog, p: number) => {
    prog[k] = p;
    const li = $(`.loads li[data-k="${k}"]`);
    li.querySelector('b')!.style.width = `${Math.round(p * 100)}%`;
    li.classList.toggle('done', p >= 1);
    face.progress = prog.llm * 0.8 + prog.stt * 0.12 + prog.tts * 0.08;
  };

  try {
    await Promise.all([
      brain.load(settings.model, (p) => bar('llm', p)).then(() => bar('llm', 1)),
      ears.load((p) => bar('stt', p)).then(() => bar('stt', 1)),
      mouth.load((p) => bar('tts', p)).then(() => bar('tts', 1)),
      micReady,
    ]);
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    startBtn.textContent = 'Try again';
    $('#boot-hint').textContent = `Falhou ao carregar: ${(err as Error).message ?? err}`;
    face.set('sad');
    return;
  }
  $('#boot').classList.add('hidden');
  booted = true;
  setMode(mode);
});

setStatus('');

if (import.meta.env.DEV) Object.assign(window, { lm: { brain, ears, mouth, player, face, settings } });
