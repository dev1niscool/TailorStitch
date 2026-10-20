import { defineConfig } from 'vite';

export default defineConfig({
  // Relative URLs work at /TailorStitch/ on Pages and in Capacitor's bundle.
  base: './',
  build: { target: 'es2022' },
});
