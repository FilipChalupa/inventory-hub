import { expect, test } from '@playwright/test';
import { devLogin } from './helpers.js';

test.describe('auth', () => {
  test('redirects unauthenticated users to /login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Inventory Hub' })).toBeVisible();
  });

  test('dev-login lands on the assets page', async ({ page }) => {
    await devLogin(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Assety' })).toBeVisible();
  });

  test('logout sends the user back to /login', async ({ page }) => {
    await devLogin(page);
    await page.getByRole('button', { name: /Odhlásit/i }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
