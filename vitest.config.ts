import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // Match Next.js' automatic JSX runtime so @react-pdf renderer modules (.tsx)
  // imported by tests transform without a manual `import React`.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'components/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'prisma', 'tests/e2e/**'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      // The Next.js `server-only` package is a guardrail that throws on
      // client imports; under Vitest there's no client/server split, so
      // alias it to an empty module so test files can import the
      // server-only modules they exercise.
      'server-only': resolve(__dirname, 'test-utils/server-only-shim.ts'),
    },
  },
});
