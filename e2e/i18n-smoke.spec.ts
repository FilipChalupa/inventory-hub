import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

// Pages reachable from the main nav that should render in the active locale.
const LIST_PAGES = [
  '/',
  '/assets',
  '/loans',
  '/calendar',
  '/inventory',
  '/contacts',
  '/audit',
  '/users',
  '/settings',
  '/scan',
];

/** Force a locale (bypassing browser-language detection) before the app boots. */
async function login(page: Page, locale: 'cs' | 'en'): Promise<void> {
  await page.addInitScript((l) => localStorage.setItem('ih.locale', l), locale);
  await page.goto('/login');
  await page.getByPlaceholder('admin@example.com').fill('admin@example.com');
  await page.getByRole('button', { name: /Dev login/i }).click();
  await page.waitForURL('**/');
}

/** Collect console errors + uncaught page errors while driving the app. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

test('smoke: every main page renders in Czech with no runtime errors', async ({ page }) => {
  const errors = trackErrors(page);
  await login(page, 'cs');
  await expect(page.getByRole('heading', { name: 'Dnes', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Assety', exact: true })).toBeVisible();

  for (const path of LIST_PAGES) {
    await page.goto(path);
    await expect(page.locator('header')).toBeVisible();
    await page.waitForTimeout(150);
  }
  await page.goto('/settings');
  await page.screenshot({ path: 'test-results/i18n-cs-settings.png', fullPage: true });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('smoke: every main page renders in English with no runtime errors', async ({ page }) => {
  const errors = trackErrors(page);
  await login(page, 'en');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Assets', exact: true })).toBeVisible();

  for (const path of LIST_PAGES) {
    await page.goto(path);
    await expect(page.locator('header')).toBeVisible();
    await page.waitForTimeout(150);
  }
  await page.goto('/settings');
  await page.screenshot({ path: 'test-results/i18n-en-settings.png', fullPage: true });
  await page.goto('/');
  await page.screenshot({ path: 'test-results/i18n-en-home.png', fullPage: true });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('language switcher flips the UI live', async ({ page }) => {
  await login(page, 'cs');
  await expect(page.getByRole('link', { name: 'Assety', exact: true })).toBeVisible();

  // Open the user menu (top-right) — the language switcher lives in its
  // dropdown — and switch to English.
  await page.getByRole('button').filter({ hasText: 'E2E Admin' }).click();
  await page.locator('header select[aria-label="Language"]').selectOption('en');
  await expect(page.getByRole('link', { name: 'Assets', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Assety', exact: true })).toHaveCount(0);
});
