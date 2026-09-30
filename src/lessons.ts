// Prompts, JSON schemas and scoring for the four practice modes.

export type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
export type Lang = 'pt' | 'en';

const LEVEL_GUIDE: Record<Level, string> = {
  A1: 'absolute beginner (CEFR A1): very common words, present simple, sentences of at most 8 words',
  A2: 'elementary (CEFR A2): everyday vocabulary, simple past and future, sentences of at most 12 words',
  B1: 'intermediate (CEFR B1): everyday topics, varied tenses, clear and simple structure',
  B2: 'upper-intermediate (CEFR B2): natural fluent English, phrasal verbs, some idioms',
  C1: 'advanced (CEFR C1): rich vocabulary, idioms, nuance and complex grammar',
};

const TOPICS = [
  'morning routines', 'food and cooking', 'travel plans', 'weekend activities', 'work and jobs', 'movies and series',
  'music', 'sports', 'shopping', 'the weather', 'family', 'friends', 'pets', 'technology', 'health and exercise',
  'city life', 'nature', 'holidays', 'school memories', 'hobbies', 'restaurants', 'the airport', 'a job interview',
  'a doctor appointment', 'hotels', 'coffee shops', 'social media', 'books', 'dreams and goals', 'childhood',
  'the environment', 'public transport', 'birthdays', 'video games', 'the beach', 'a funny story', 'house chores',
];

export const pickTopic = () => TOPICS[Math.floor(Math.random() * TOPICS.length)];

const explainIn = (lang: Lang) => (lang === 'pt' ? 'Brazilian Portuguese' : 'simple English');

// ─── Talk ──────────────────────────────────────────────────────────────────

export interface TalkTurn {
  has_mistake: boolean;
  corrected: string;
  reply: string;
  explanation: string;
  hints: string[];
}

export const talkSchema = {
  type: 'object',
  properties: {
    has_mistake: { type: 'boolean' },
    corrected: { type: 'string' },
    reply: { type: 'string' },
    explanation: { type: 'string' },
    hints: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 },
  },
  required: ['has_mistake', 'corrected', 'reply', 'explanation', 'hints'],
};

export const talkSystem = (level: Level, lang: Lang) => `You are Mia, a warm, playful English tutor talking out loud with a Brazilian learner.
Learner level: ${LEVEL_GUIDE[level]}.

Respond with JSON, fields in this order:
- "has_mistake": carefully check the learner's LAST message for grammar mistakes (verb tense, agreement, articles, prepositions, word order), wrong words or unnatural phrasing. It is a speech transcript, so IGNORE punctuation, capitalization and spelling. true only if there is a real mistake.
- "corrected": if has_mistake, their whole message fixed; else "".
- "reply": what you say out loud. 1-3 short spoken sentences (max 35 words), natural and friendly, matched to the learner's level. React to what they said, then ask ONE follow-up question to keep them talking. No emojis, no markdown, no lists.
- "explanation": if has_mistake, one short sentence in ${explainIn(lang)} explaining the main fix; else "".
- "hints": 2-3 short example answers (max 10 words each) the learner could say next to your question, at their level.

If the learner's message is in Portuguese (fully or partly): has_mistake is true, "corrected" is the English translation of what they meant, "explanation" says how to say it, and "reply" gently encourages them to try saying it in English.`;

export const talkOpeners: Record<Level, string> = {
  A1: "Hi! I'm Mia. What is your name?",
  A2: "Hi there! I'm Mia, your English buddy. How are you today?",
  B1: "Hey! I'm Mia. So, how has your day been so far?",
  B2: "Hey, great to see you! I'm Mia. What's been keeping you busy lately?",
  C1: "Hi, I'm Mia! I'm curious, what's something that's been on your mind this week?",
};

export const talkOpenerHints: Record<Level, string[]> = {
  A1: ['My name is Ana.', "I'm Lucas. Nice to meet you!"],
  A2: ["I'm fine, thanks. And you?", "I'm a little tired today."],
  B1: ['It was pretty good, thanks!', 'Busy, I had a lot of work.'],
  B2: ["I've been working on a new project.", 'Honestly, nothing much. Just relaxing.'],
  C1: ["I've been thinking about changing careers.", 'Mostly planning an upcoming trip.'],
};

// ─── Read ──────────────────────────────────────────────────────────────────

export interface ReadTask { title: string; passage: string; question: string; options: string[]; answer: number }

export const readSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    passage: { type: 'string' },
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
    answer: { type: 'integer', minimum: 0, maximum: 3 },
  },
  required: ['title', 'passage', 'question', 'options', 'answer'],
};

export const readPrompt = (level: Level) => [
  { role: 'system' as const, content: `You write short English reading exercises for a learner. Level: ${LEVEL_GUIDE[level]}. Respond with JSON.` },
  {
    role: 'user' as const,
    content: `Write a short text about "${pickTopic()}" to read out loud: ${level === 'A1' || level === 'A2' ? '2-3' : '3-4'} sentences, plain words (no names that are hard to pronounce, no numbers written as digits). Give it a 2-4 word "title". Then one comprehension "question" with 4 short "options" and the index of the correct one in "answer". Vary the correct index.`,
  },
];

// ─── Write ─────────────────────────────────────────────────────────────────

export interface WriteTask { kind: 'translate' | 'free'; instruction: string; source: string }
export interface WriteReview {
  score: number;
  corrected: string;
  natural: string;
  errors: { wrong: string; right: string; why: string }[];
  feedback: string;
}

export const writeTaskSchema = (kind: WriteTask['kind']) => ({
  type: 'object',
  properties: kind === 'translate' ? { portuguese: { type: 'string' } } : { question: { type: 'string' } },
  required: [kind === 'translate' ? 'portuguese' : 'question'],
});

export const writeTaskPrompt = (level: Level, kind: WriteTask['kind']) => [
  { role: 'system' as const, content: `You create English writing exercises for a Brazilian learner. Level: ${LEVEL_GUIDE[level]}. Respond with JSON.` },
  {
    role: 'user' as const,
    content:
      kind === 'translate'
        ? `Topic: "${pickTopic()}". In "portuguese", write ONE natural everyday sentence in Brazilian Portuguese that the learner will translate into English. Make it fit the level.`
        : `Topic: "${pickTopic()}". In "question", write ONE short personal question in English (max 15 words) that the learner will answer in ${level === 'A1' ? '1-2 sentences' : '2-4 sentences'}.`,
  },
];

export const writeReviewSchema = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    corrected: { type: 'string' },
    natural: { type: 'string' },
    errors: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        properties: { wrong: { type: 'string' }, right: { type: 'string' }, why: { type: 'string' } },
        required: ['wrong', 'right', 'why'],
      },
    },
    feedback: { type: 'string' },
  },
  required: ['score', 'corrected', 'natural', 'errors', 'feedback'],
};

export const writeReviewPrompt = (level: Level, lang: Lang, task: WriteTask, answer: string) => [
  {
    role: 'system' as const,
    content: `You are a kind but precise English writing teacher for a Brazilian learner at level ${level}. Respond with JSON:
- "score": 0-100 for grammar, vocabulary and ${task.kind === 'translate' ? 'meaning accuracy' : 'answering the prompt'}.
- "corrected": the learner's text with only the mistakes fixed.
- "natural": how a native speaker would naturally write it.
- "errors": up to 4 real mistakes, each with the "wrong" fragment, the "right" fragment and "why" in one short sentence in ${explainIn(lang)}. Empty if none.
- "feedback": one short encouraging sentence in ${explainIn(lang)}.`,
  },
  {
    role: 'user' as const,
    content: `Task: ${task.instruction}${task.source ? `\nText to translate: "${task.source}"` : ''}\nLearner wrote: "${answer}"`,
  },
];

// ─── Listen ────────────────────────────────────────────────────────────────

export interface ListenTask { text: string; question: string; options: string[]; answer: number }

export const listenSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
    answer: { type: 'integer', minimum: 0, maximum: 3 },
  },
  required: ['text', 'question', 'options', 'answer'],
};

export const listenPrompt = (level: Level, kind: 'dictation' | 'quiz') => [
  { role: 'system' as const, content: `You create English listening exercises. Level: ${LEVEL_GUIDE[level]}. Respond with JSON.` },
  {
    role: 'user' as const,
    content:
      kind === 'dictation'
        ? `Topic: "${pickTopic()}". "text": ONE natural spoken sentence (${level === 'A1' ? '4-7' : level === 'A2' ? '6-10' : '8-16'} words) for a dictation. No names, no digits. Also add a simple "question" about it with 4 "options" and correct index "answer".`
        : `Topic: "${pickTopic()}". "text": a short spoken monologue or message (${level === 'A1' || level === 'A2' ? '2-3' : '3-5'} sentences) with one or two concrete details. "question": about a specific detail. 4 short "options", correct index in "answer". Vary the correct index.`,
  },
];

// ─── Scoring ───────────────────────────────────────────────────────────────

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const CONTRACTIONS: Record<string, string> = {
  "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "he's": 'he is', "she's": 'she is',
  "it's": 'it is', "that's": 'that is', "there's": 'there is', "what's": 'what is', "let's": 'let us',
  "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "can't": 'cannot', "won't": 'will not',
  "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not', "i've": 'i have',
  "you've": 'you have', "we've": 'we have', "they've": 'they have', "i'll": 'i will', "you'll": 'you will',
  "we'll": 'we will', "i'd": 'i would', "couldn't": 'could not', "wouldn't": 'would not', "shouldn't": 'should not',
  "haven't": 'have not', "hasn't": 'has not', gonna: 'going to', wanna: 'want to', ok: 'okay',
};

/** Lowercased word tokens with contractions expanded; `src` maps each token back to the original word index. */
function tokens(text: string): { norm: string[]; src: number[] } {
  const norm: string[] = [], src: number[] = [];
  text.split(/\s+/).filter(Boolean).forEach((w, i) => {
    let t = w.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');
    if (!t) return;
    if (/^\d+$/.test(t) && +t <= 20) t = NUMBERS[+t];
    for (const part of (CONTRACTIONS[t] ?? t).split(' ')) { norm.push(part); src.push(i); }
  });
  return { norm, src };
}

/**
 * Aligns what the learner said/typed against the target text (LCS) and marks every target word.
 * Returns the target's words with an ok flag, and a 0-100 score.
 */
export function compareWords(target: string, attempt: string): { words: { text: string; ok: boolean }[]; score: number } {
  const words = target.split(/\s+/).filter(Boolean);
  const a = tokens(target), b = tokens(attempt);
  const n = a.norm.length, m = b.norm.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a.norm[i] === b.norm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hit = new Array(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a.norm[i] === b.norm[j]) { hit[i] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const ok = new Array(words.length).fill(true);
  a.src.forEach((wi, k) => { if (!hit[k]) ok[wi] = false; });
  const counted = new Set(a.src);
  const good = [...counted].filter((wi) => ok[wi]).length;
  // Penalize extra words a bit so rambling doesn't score 100.
  const extra = Math.max(0, m - dp[0][0]);
  const score = counted.size ? Math.round((100 * good) / (counted.size + extra * 0.5)) : 0;
  return { words: words.map((text, i) => ({ text, ok: ok[i] })), score: Math.min(100, score) };
}
