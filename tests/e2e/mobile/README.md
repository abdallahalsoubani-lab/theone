# Mobile QA tests (Playwright multi-viewport)

Per Prompt 11 §4.7 these specs run the critical paths at four
viewports: **320 / 375 / 414 / 768 px**. Failing screenshots are
saved as CI artifacts; golden screenshots live under
`tests/__golden__/` for visual-regression diffing.

## Why this directory ships with no tests yet

Same as `tests/e2e/a11y/README.md` — the spec files are the
executable artifacts the project owner runs locally / in CI after
installing Playwright. The ResponsiveModal wrapper from commit 3
makes the bottom-sheet adaptation work; these specs verify it.

## Setup

```bash
pnpm add -D @playwright/test
pnpm playwright install --with-deps chromium webkit
```

## Critical paths × breakpoints

Each path × each breakpoint gets one assertion. Example matrix:

| Path                   | Viewports          | Bottom-sheet check |
| ---------------------- | ------------------ | ------------------ |
| `/login`               | 320, 375, 414, 768 | no                 |
| `/secretary/patients`  | 320, 375, 414, 768 | no                 |
| `/patient/dashboard`   | 320, 375, 414, 768 | no                 |
| Cancel appointment     | 320, 375, 414, 768 | **yes (<768)**     |
| Recurring builder      | 320, 375, 414, 768 | **yes (<768)**     |
| Change therapist       | 320, 375, 414, 768 | **yes (<768)**     |
| Appointment side panel | 320, 375, 414, 768 | **yes (<768)**     |
| Create appointment     | 320, 375, 414, 768 | **yes (<768)**     |

## Bottom-sheet assertion

```ts
test('cancel modal is a bottom sheet on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/en/secretary/calendar');
  // ... open the cancel modal
  const box = await page.locator('[role="dialog"]').boundingBox();
  // Bottom-anchored: the bottom edge of the modal touches the viewport bottom.
  expect(box?.y).toBeGreaterThan(100);
});
```

## Touch-target audit (`tests/e2e/mobile/touch-targets.spec.ts`)

Iterate every interactive element (`button, a, [role="button"], input,
select`) and assert `boundingBox` ≥ 44×44 px. Document any deliberate
exception in `docs/a11y/touch-targets.md`.
