import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config (first committed config — Prompt 46 item C).
 *
 * The specs run against an ALREADY-RUNNING app (dev or prod build) so they
 * never fight the Vitest gate or CI unit jobs:
 *
 *   pnpm infra:up && pnpm db:reset && pnpm dev   # terminal 1
 *   pnpm playwright install chromium             # once
 *   pnpm exec playwright test                    # terminal 2
 *
 * `PW_BASE_URL` overrides the target (default http://localhost:3000 —
 * pass http://localhost:3001 if :3000 is taken locally).
 *
 * Specs that sign in use the Tier-2 dev-seed credentials, so they are
 * dev-environment-only by design — exactly like the seed itself.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.PW_BASE_URL ?? 'http://localhost:3000',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      testMatch: /mobile\/.*\.spec\.ts/,
      // iPhone profile for viewport/touch/UA, forced onto chromium so the
      // suite needs only one installed browser (`playwright install chromium`).
      use: { ...devices['iPhone 12'], browserName: 'chromium' },
    },
    {
      name: 'desktop-chromium',
      testIgnore: /mobile\//,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
