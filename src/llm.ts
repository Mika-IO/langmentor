import { CreateWebWorkerMLCEngine, type ChatCompletionMessageParam, type WebWorkerMLCEngine } from '@mlc-ai/web-llm';

export const MODELS = [
  { id: 'Qwen3.5-4B-q4f16_1-MLC', label: 'Qwen 3.5 · 4B', note: 'Recomendado · ~4 GB de VRAM' },
  { id: 'Qwen3.5-9B-q4f16_1-MLC', label: 'Qwen 3.5 · 9B', note: 'Mais inteligente · ~6.5 GB de VRAM' },
  { id: 'Llama-3.1-8B-Instruct-q4f16_1-MLC', label: 'Llama 3.1 · 8B', note: 'Inglês bem natural · ~5 GB de VRAM' },
  { id: 'Qwen3.5-2B-q4f16_1-MLC', label: 'Qwen 3.5 · 2B', note: 'Leve e rápido · ~2.2 GB de VRAM' },
];

export type Msg = ChatCompletionMessageParam;

export class Brain {
  private engine: WebWorkerMLCEngine | null = null;
  model = '';
  lastUsage: unknown = null;

  async load(model: string, onProgress: (p: number, text: string) => void) {
    if (this.engine && this.model === model) return;
    const cb = (r: { progress: number; text: string }) => onProgress(r.progress, r.text);
    if (this.engine) {
      this.engine.setInitProgressCallback(cb);
      await this.engine.reload(model);
    } else {
      this.engine = await CreateWebWorkerMLCEngine(
        new Worker(new URL('./workers/llm.worker.ts', import.meta.url), { type: 'module' }),
        model,
        { initProgressCallback: cb },
      );
    }
    this.model = model;
  }

  /**
   * Streams a JSON object constrained by `schema`. `onText` receives the raw text so far,
   * so callers can pull fields out early (see `partialString`).
   */
  async json<T>(messages: Msg[], schema: object, opts: { temperature?: number; maxTokens?: number; onText?: (t: string) => void } = {}): Promise<T> {
    return (await this.jsonRaw<T>(messages, schema, opts)).data;
  }

  /**
   * Like `json`, but also returns the raw model output. Feeding that raw text back as the assistant
   * message on the next turn lets WebLLM reuse its KV cache instead of re-reading the whole chat.
   */
  async jsonRaw<T>(messages: Msg[], schema: object, opts: { temperature?: number; maxTokens?: number; onText?: (t: string) => void } = {}): Promise<{ data: T; raw: string }> {
    if (!this.engine) throw new Error('LLM not loaded');
    const stream = await this.engine.chat.completions.create({
      messages,
      stream: true,
      temperature: opts.temperature ?? 0.7,
      top_p: 0.9,
      max_tokens: opts.maxTokens ?? 500,
      response_format: { type: 'json_object', schema: JSON.stringify(schema) },
      extra_body: { enable_thinking: false },
      stream_options: { include_usage: true },
    } as any);
    let text = '';
    for await (const chunk of stream as unknown as AsyncIterable<any>) {
      if (chunk.usage) this.lastUsage = chunk.usage;
      const delta = chunk.choices[0]?.delta?.content;
      if (!delta) continue;
      text += delta;
      opts.onText?.(text);
    }
    return { data: parseJson<T>(text), raw: text };
  }

  interrupt() { this.engine?.interruptGenerate(); }
}

function parseJson<T>(text: string): T {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
  return JSON.parse(clean.slice(a, b + 1)) as T;
}

/** Extracts a (possibly still-streaming) string field from partial JSON. */
export function partialString(text: string, key: string): { value: string; closed: boolean } | null {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)(")?`));
  if (!m) return null;
  const raw = m[1].replace(/\\u?[0-9a-fA-F]{0,3}$|\\$/, '');
  let value: string;
  try { value = JSON.parse(`"${raw}"`); } catch { value = raw; }
  return { value, closed: !!m[2] };
}
