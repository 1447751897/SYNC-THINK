/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

// JSDOM environment so React components can mount without Electron.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
  },
});
