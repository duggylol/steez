import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the UI runs on Vite (5173); API, websockets and overlays live on the Steez server.
const target = 'http://127.0.0.1:43112';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: '.',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': target,
      '/ws': { target: target.replace('http', 'ws'), ws: true },
      '/overlay': target,
      '/queueup-ws': { target: target.replace('http', 'ws'), ws: true },
    },
  },
});
