import { expect, test } from '@playwright/test';
import { devLogin } from './helpers.js';

test.describe('reservations', () => {
  test('a member requests a reservation and an admin approves it', async ({ page }) => {
    // Admin creates an asset that can be reserved.
    await devLogin(page);
    const create = await page.request.post('/api/assets', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ name: 'Reservable', code: 'LAP-95001' }),
    });
    expect(create.ok()).toBeTruthy();

    // The member requests a reservation for it (self-service).
    await page.context().clearCookies();
    await devLogin(page, 'member@example.com');
    const request = await page.request.post('/api/loans/request', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ assetCodes: ['LAP-95001'], purpose: 'E2E reservation' }),
    });
    expect(request.ok()).toBeTruthy();

    // The admin sees it in the pending-approval queue and approves it.
    await page.context().clearCookies();
    await devLogin(page);
    await page.goto('/loans');
    await expect(page.getByText('Čeká na schválení')).toBeVisible();
    await page.getByRole('button', { name: 'Schválit', exact: true }).first().click();

    // Once approved the pending section is empty and disappears.
    await expect(page.getByText('Čeká na schválení')).toHaveCount(0);
  });
});
