import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  worker: { format: 'es' },
  test: { include: ['src/**/*.test.ts'] },
});
