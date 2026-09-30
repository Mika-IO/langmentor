# langmentor

Tutor de inglês por voz que roda **100% local no navegador**: nenhuma chamada de API e nenhum servidor. Seu áudio e seus textos não saem da máquina.

Você pratica as 4 habilidades:

| Modo | O que faz | Habilidades |
|---|---|---|
| **Talk** | Conversa por voz com a Mia. Ela responde falando, corrige seus erros e sugere respostas. Tem modo mãos-livres. | fala + escuta |
| **Read** | A IA gera um texto no seu nível. Você lê em voz alta e cada palavra fica verde ou vermelha. Depois vem uma pergunta de interpretação. | leitura + pronúncia |
| **Write** | Alterna entre tradução PT→EN e perguntas abertas. Dá nota, correção, versão nativa e explica os erros. | escrita |
| **Listen** | Alterna entre ditado (digitar o que ouviu) e perguntas sobre um áudio. Tem botão pra ouvir mais devagar. | escuta |

## Modelos

| Função | Modelo | Runtime |
|---|---|---|
| Cérebro (LLM) | **Qwen3.5-4B** (padrão). Dá pra trocar por Qwen3.5-9B, Llama-3.1-8B ou Qwen3.5-2B | [WebLLM](https://github.com/mlc-ai/web-llm) (WebGPU) |
| Ouvidos (STT) | **Whisper small.en** | [transformers.js](https://github.com/huggingface/transformers.js) (WebGPU) |
| Voz (TTS) | **Kokoro-82M** | [kokoro-js](https://github.com/hexgrad/kokoro) (WebGPU, com fallback pra WASM) |

Por que esses modelos:
- **WebLLM** é o runtime de LLM mais rápido no navegador. Ele suporta *JSON schema* (via XGrammar), e a app usa isso pra receber sempre respostas estruturadas: fala, correção, dicas, múltipla escolha etc.
- **Qwen3.5-4B** equilibra qualidade de correção gramatical e velocidade. Modelos de 1B ou menos erram demais nas correções.
- **Whisper small.en** entende bem o sotaque de quem está aprendendo. O `base` erra mais.
- **Kokoro** é o TTS open-source leve com a voz mais natural hoje, bem melhor que as vozes do sistema.

A Web Speech API do Chrome **não** é usada pra reconhecimento de voz porque ela manda o áudio pro Google.

## Rodar

Requisitos: **Chrome/Edge 113+** ou **Safari 26+** com WebGPU, e cerca de 8 GB de RAM (16 GB se for usar o modelo 9B).

```bash
npm install
npm run dev        # http://localhost:5173
```

Build de produção:

```bash
npm run build && npm run preview
```

Na primeira vez que você clica em **Start**, os modelos são baixados (cerca de 3 GB no total com o modelo padrão) e ficam guardados no Cache Storage do navegador. Nas próximas vezes carregam do disco e funcionam **offline**. O runtime ONNX (`public/ort/`) é copiado pelo `postinstall`, então também não depende de CDN.

## Uso

- **Toque no rosto** (ou aperte `Espaço`) pra falar. Pare de falar e ele envia sozinho depois de ~1,2 s de silêncio. Se tocar enquanto ela fala, ela para e passa a te ouvir.
- No Talk, toque em uma sugestão ou correção pra ouvir a pronúncia.
- No Read, toque em qualquer palavra pra ouvir como se fala.
- ⚙️ **Configurações:** nível (A1–C1), idioma das explicações (PT/EN), voz, velocidade, modelo e modo mãos-livres.

## Arquitetura

```
src/
  main.ts            UI e fluxo dos 4 modos
  face.ts            rosto animado + waveform circular (canvas)
  audio.ts           microfone com VAD por energia (AudioWorklet) + player sem gaps
  speech.ts          clientes dos workers de STT/TTS e fila de frases pra falar
  llm.ts             WebLLM: JSON em streaming e extração parcial de campos
  lessons.ts         prompts, JSON schemas e pontuação por palavra (alinhamento LCS)
  workers/           llm / stt / tts, cada um em um Web Worker
```

Latência no Talk: o LLM gera o JSON em streaming. Assim que o campo `reply` tem uma frase completa, ela já vai pro Kokoro, então a Mia começa a falar enquanto o modelo ainda escreve a correção e as dicas.
