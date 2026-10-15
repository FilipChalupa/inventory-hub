import { expect, test } from '@playwright/test';
import { devLogin } from './helpers.js';

test.describe('AI assistants (MCP)', () => {
  test('mint a personal token, see it listed, then disconnect it', async ({ page }) => {
    await devLogin(page);
    await page.goto('/agents');
    await expect(page.getByRole('heading', { name: 'AI asistenti (MCP)' })).toBeVisible();

    await page.getByPlaceholder('např. n8n, můj agent').fill('E2E agent');
    await page.getByRole('button', { name: 'Vytvořit token' }).click();
    await expect(page.getByText(/^ihm_/).first()).toBeVisible();

    // Admins also see the org-wide list, so the token shows up twice.
    const row = page.getByRole('listitem').filter({ hasText: 'E2E agent' }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('Jen čtení');

    await row.getByRole('button', { name: 'Odpojit' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Odpojit' }).click();
    await expect(page.getByText('Zatím nemáš připojeného žádného asistenta.')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'E2E agent' })).toHaveCount(0);
  });
});
