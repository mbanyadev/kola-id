import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  base: './',
  plugins: [wasm()],
  build: { target: 'esnext', outDir: 'dist', emptyOutDir: true },
  optimizeDeps: { exclude: ['@midnight-ntwrk/onchain-runtime-v3', '@midnight-ntwrk/compact-runtime'] },
  server: { fs: { allow: ['../..'] } },
});
