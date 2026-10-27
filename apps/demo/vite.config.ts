import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  base: './',
  plugins: [wasm()],
  build: { target: 'esnext', outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 8000 },
  // Pre-bundling breaks the start-up order of the Midnight WebAssembly packages.
  optimizeDeps: {
    exclude: ['@midnight-ntwrk/onchain-runtime-v3', '@midnight-ntwrk/compact-runtime', '@midnight-ntwrk/ledger-v8'],
  },
  server: { fs: { allow: ['../..'] } },
});
