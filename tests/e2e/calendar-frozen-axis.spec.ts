import { expect, test, type Page } from '@playwright/test';

/**
 * Prompt 47 row 9 + owner request — calendar fit & frozen axes:
 *
 *   - the page itself must NOT scroll horizontally (the flex pane is
 *     clamped with min-w-0; overflow lives inside the calendar),
 *   - scrolling the grid toward a hidden therapist keeps the HOUR GUTTER
 *     frozen at its edge (rbc's sticky axis, engaged now that the calendar
 *     is the scroll container) and keeps the names header scroll-synced,
 *   - scrolling down keeps the therapist-names header row visible.
 *
 * Runs in en AND ar. NOTE: the frozen edge is the LEFT one in BOTH locales
 * by design — the calendar's internal direction is pinned to LTR under RTL
 * pages (the long-standing rbc-RTL decision in calendar.css), so the Arabic
 * calendar deliberately matches the English layout.
 *
 * Needs the dev-seeded app (see playwright.config.ts header). The viewport
 * is narrow so even the 4 seeded therapist lanes overflow; production has
 * 13+ lanes and overflows on any laptop.
 */

async function loginAsSecretary(page: Page, locale: 'en' | 'ar') {
  await page.goto(`/${locale}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: /email|البريد/i }).fill('reception@theone.pt');
  await page.getByRole('textbox', { name: /password|كلمة/i }).fill('Reception@123');
  await page.getByRole('button', { name: /^sign in$|تسجيل الدخول/i }).click();
  await page.waitForURL(new RegExp(`/${locale}/secretary/calendar`), { timeout: 60_000 });
}

for (const locale of ['en', 'ar'] as const) {
  test(`frozen time axis + frozen header while scrolling (${locale})`, async ({ page }) => {
    await loginAsSecretary(page, locale);
    await page.setViewportSize({ width: 420, height: 740 });
    await page.waitForSelector('.rbc-time-view-resources', { timeout: 30_000 });
    await page.waitForTimeout(800);

    // The page never scrolls horizontally — overflow is the calendar's.
    const pageOverflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(pageOverflows).toBe(false);

    const grid = page.locator('.rbc-time-content');
    const gutter = page.locator('.rbc-time-content .rbc-time-gutter');
    const headerGutter = page.locator('.rbc-time-header-gutter');
    const header = page.locator('.rbc-time-header');

    // The narrow viewport must actually produce horizontal overflow.
    const overflow = await grid.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeGreaterThan(40);

    const gutterX0 = (await gutter.boundingBox())!.x;
    const headerGutterX0 = (await headerGutter.boundingBox())!.x;
    const headerY0 = (await header.boundingBox())!.y;

    // Scroll toward the hidden therapist columns.
    await grid.evaluate((el) => {
      el.scrollLeft = 120;
    });
    await page.waitForTimeout(300);

    // Hour gutter and its header cell stay frozen at the same edge…
    expect(Math.abs((await gutter.boundingBox())!.x - gutterX0)).toBeLessThanOrEqual(1);
    expect(Math.abs((await headerGutter.boundingBox())!.x - headerGutterX0)).toBeLessThanOrEqual(1);
    // …while the names header scrolls in sync with the grid.
    expect(await header.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);

    // Scroll down to the evening — the names header row must stay visible.
    await grid.evaluate((el) => {
      el.scrollTop = 300;
    });
    await page.waitForTimeout(300);
    expect(Math.abs((await header.boundingBox())!.y - headerY0)).toBeLessThanOrEqual(1);
    await expect(header).toBeVisible();
  });
}
