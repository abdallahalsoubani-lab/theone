import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // Match Next.js' automatic JSX runtime so @react-pdf renderer modules (.tsx)
  // imported by tests transform without a manual `import React`.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    // Prompt 31: the suite always runs on a UTC clock (prod-VM parity) so any
    // code that leans on the process timezone fails loudly instead of passing
    // on an Amman-configured dev machine. The pnpm scripts also set TZ=UTC;
    // this covers direct `vitest` invocations too.
    env: { TZ: 'UTC' },
    include: [
      'lib/**/*.test.ts',
      'app/**/*.test.ts',
      'components/**/*.test.ts',
      'workers/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
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
