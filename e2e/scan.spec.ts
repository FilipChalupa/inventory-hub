import { expect, test } from '@playwright/test';
import { devLogin } from './helpers.js';

test.describe('scan', () => {
  test('typing a serial number opens its asset', async ({ page }) => {
    await devLogin(page);
    const post = (path: string, body: unknown) =>
      page.request.post(path, {
        headers: { 'content-type': 'application/json' },
        data: JSON.stringify(body),
      });
    expect(
      (await post('/api/assets', { name: 'Serial Scan Laptop', code: 'LAP-96001' })).ok(),
    ).toBe(true);
    expect(
      (
        await post('/api/assets/LAP-96001/external-ids', { kind: 'serial', value: 'SN-77-ABC' })
      ).ok(),
    ).toBe(true);

    await page.goto('/scan');
    // Separators/case don't matter for the lookup.
    await page.getByRole('textbox', { name: 'Ruční zadání' }).fill('sn77abc');
    await page.getByRole('button', { name: 'Otevřít', exact: true }).click();
    await expect(page).toHaveURL(/\/a\/LAP-96001$/);
    await expect(page.getByRole('heading', { name: 'Serial Scan Laptop' })).toBeVisible();

    await page.goto('/scan');
    await page.getByRole('textbox', { name: 'Ruční zadání' }).fill('NOPE-NOTHING');
    await page.getByRole('button', { name: 'Otevřít', exact: true }).click();
    await expect(page.getByText('Nic s identifikátorem „NOPE-NOTHING" nenalezeno.')).toBeVisible();
  });

  test('Ctrl+K puts an exact serial match first and says why', async ({ page }) => {
    await devLogin(page);
    const post = (path: string, body: unknown) =>
      page.request.post(path, {
        headers: { 'content-type': 'application/json' },
        data: JSON.stringify(body),
      });
    await post('/api/assets', { name: 'Palette Serial Laptop', code: 'LAP-96002' });
    await post('/api/assets/LAP-96002/external-ids', { kind: 'serial', value: 'PAL-55-XY' });

    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('pal55xy');
    const first = page.getByRole('option').filter({ hasText: 'LAP-96002' });
    await expect(first).toContainText('Sériové číslo: PAL-55-XY');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/a\/LAP-96002$/);
  });
});
