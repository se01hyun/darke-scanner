import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DS_DEBUG__: 'false',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts'],
  },
});
