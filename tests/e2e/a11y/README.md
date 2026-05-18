# Accessibility tests (Playwright + axe-core)

Per Prompt 11 §4.8 these specs gate CI on **serious** and **critical**
WCAG 2.1 AA violations. Moderate and minor violations are reported
but do not fail the build (track in backlog).

## Why this directory ships with no tests yet

Playwright requires a browser binary and a running app under test;
neither is available in the Sonnet-driven build environment. The
spec files below are the executable artifacts the project owner runs
locally / in CI after `pnpm playwright install`.

## Setup

```bash
pnpm add -D @playwright/test @axe-core/playwright @axe-core/react
pnpm playwright install --with-deps chromium
```

## Critical paths

Each path gets one spec under `tests/e2e/a11y/`:

- `login.spec.ts` — both tabs (password + OTP)
- `calendar.spec.ts` — day view with mock appointments
- `create-appointment.spec.ts` — single + recurring modals
- `intake.spec.ts` — adult intake form
- `patient-file-profile.spec.ts`
- `patient-file-timeline.spec.ts`
- `home-program.spec.ts`

## Skeleton

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('login page has no serious/critical a11y violations', async ({ page }) => {
  await page.goto('/en/login');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(blocking).toEqual([]);
});
```

## CI wiring

Add to `.github/workflows/ci.yml`:

```yaml
- run: pnpm test:a11y
```

with a `test:a11y` script alias for `playwright test tests/e2e/a11y`.
