import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', channel: 'msedge', headless: true },
  webServer: { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: false, timeout: 30000 },
});
