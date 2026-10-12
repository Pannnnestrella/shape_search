import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/model': { target: 'http://127.0.0.1:8010', rewrite: (url) => url.replace(/^\/model/, '') } } },
  preview: { proxy: { '/model': { target: 'http://127.0.0.1:8010', rewrite: (url) => url.replace(/^\/model/, '') } } },
});
