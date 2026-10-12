import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // three.js is loaded on demand, only once the ocarina scrolls into view.
  build: { chunkSizeWarningLimit: 800 },
});
