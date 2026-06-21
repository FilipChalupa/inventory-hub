import { expect, test } from '@playwright/test';
import { devLogin } from './helpers.js';

test.describe('auth', () => {
  test('redirects unauthenticated users to /login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Inventory Hub' })).toBeVisible();
  });

  test('dev-login lands on the home dashboard', async ({ page }) => {
    await devLogin(page);
    await expect(page).toHaveURL(/\/$/);
    // exact: the home page also has "Vrátit dnes" / "Začíná dnes" bucket headings.
    await expect(page.getByRole('heading', { name: 'Dnes', exact: true })).toBeVisible();
  });

  test('logout sends the user back to /login', async ({ page }) => {
    await devLogin(page);
    // Logout lives in the user-menu dropdown — open it first.
    await page.getByRole('button').filter({ hasText: 'E2E Admin' }).click();
    await page.getByRole('button', { name: /Odhlásit/i }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
