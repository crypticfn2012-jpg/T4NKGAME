import { defineConfig } from 'vite';

// base: './' makes the built bundle work when opened from any path /
// file:// (useful for a self-contained single-HTML demo).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 700,
    sourcemap: false
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true
      }
    }
  }
});
