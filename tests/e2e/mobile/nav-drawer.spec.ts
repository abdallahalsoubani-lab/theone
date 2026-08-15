import { expect, test, type Page } from '@playwright/test';

/**
 * Prompt 46 item C regression guard — "works on desktop, dead on phones".
 *
 * The mobile drawer shipped receiving a hard-coded empty links array, so on
 * every viewport below `md` the hamburger opened an EMPTY drawer for every
 * role. This spec pins the fix at a phone viewport for the richest nav
 * (admin) in both locales: the drawer opens, shows nav items, and navigates.
 *
 * Runs against a dev-seeded app (see playwright.config.ts header).
 */

const ADMIN_EMAIL = 'admin@theone.pt';
const ADMIN_PASSWORD = 'Admin@123';

async function loginAsAdmin(page: Page, locale: 'en' | 'ar') {
  await page.goto(`/${locale}/login`);
  await page.getByRole('textbox', { name: /email|البريد/i }).fill(ADMIN_EMAIL);
  await page.getByRole('textbox', { name: /password|كلمة/i }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in|تسجيل الدخول/i }).click();
  await page.waitForURL(new RegExp(`/${locale}/admin`), { timeout: 30_000 });
}

for (const locale of ['en', 'ar'] as const) {
  test(`mobile drawer shows the admin nav and navigates (${locale})`, async ({ page }) => {
    await loginAsAdmin(page, locale);

    // The hamburger only renders below md — the iPhone viewport guarantees it.
    const trigger = page.getByRole('button', { name: /open menu|فتح القائمة/i });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();

    // The regression: the drawer used to contain zero links.
    const items = drawer.locator('nav a');
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThanOrEqual(5);

    // Every item is actually inside the viewport (not rendered off-canvas —
    // the RTL failure mode from the culprit checklist). toBeInViewport
    // auto-retries, so the slide-in animation can finish first.
    await expect(items.first()).toBeInViewport({ ratio: 0.9 });
    await expect(items.last()).toBeInViewport({ ratio: 0.5 });

    // Navigation works and closes the drawer.
    await drawer.locator('nav a', { hasText: /users|المستخدمون/i }).click();
    await page.waitForURL(new RegExp(`/${locale}/admin/users`));
    await expect(page.getByRole('dialog')).toBeHidden();
  });
}
