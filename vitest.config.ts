import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true, // the Priya spec was written for Jest globals
    include: ['superhuman/tests/**/*.test.ts', 'priya/guardrails/__tests__/**/*.spec.ts', 'demo/**/*.test.ts'],
  },
});
