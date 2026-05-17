import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript', 'prettier'),
  ...compat.config({
    rules: {
      // Class ordering is handled by prettier-plugin-tailwindcss (see .prettierrc).
      // The ESLint Tailwind plugin would duplicate that work and fights pnpm's strict
      // module layout; we rely on Prettier as the single source of truth instead.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      // Allow underscore-prefixed args and vars to mean "intentionally unused".
      // Convention is widely used for stub functions and signature parity.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  }),
  {
    ignores: ['.next/**', 'node_modules/**', 'out/**', 'next-env.d.ts', 'public/**'],
  },
];

export default config;
