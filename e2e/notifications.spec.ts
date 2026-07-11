import { expect, test } from '@playwright/test';
import { devLogin } from './helpers.js';

test.describe('notifications', () => {
  test('the bell surfaces an overdue loan', async ({ page }) => {
    await devLogin(page);

    // An asset on a loan whose return date is already in the past = overdue.
    await page.request.post('/api/assets', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ name: 'Overdue Item', code: 'LAP-94001' }),
    });
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const loan = await page.request.post('/api/loans', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({
        borrowerName: 'E2E Overdue',
        borrowerContact: 'overdue@example.com',
        expectedReturnAt: past,
        assetCodes: ['LAP-94001'],
      }),
    });
    expect(loan.ok()).toBeTruthy();

    // Reload so the bell refetches, then open it — the overdue loan shows up.
    await page.reload();
    await page.getByRole('button', { name: /Otevřít notifikace/i }).click();
    await expect(page.getByRole('menuitem').first()).toBeVisible();
  });
});
