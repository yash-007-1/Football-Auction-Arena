import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Vite server proxies API and websocket traffic to the Node server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
