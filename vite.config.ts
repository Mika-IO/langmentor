import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; CI sets BASE_PATH accordingly.
  base: process.env.BASE_PATH ?? '/',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@mlc-ai/web-llm', '@huggingface/transformers', 'kokoro-js'] },
  build: { target: 'es2022' },
});
