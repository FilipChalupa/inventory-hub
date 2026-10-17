import { expect, test } from '@playwright/test';
import { devLogin } from './helpers.js';

test.describe('inventory relocation', () => {
  test('flags an asset found in another room and moves it there', async ({ page }) => {
    await devLogin(page);
    const post = async (path: string, body: unknown) =>
      (
        await page.request.post(path, {
          headers: { 'content-type': 'application/json' },
          data: JSON.stringify(body),
        })
      ).json();
    const store = await post('/api/locations', { name: 'Reloc store' });
    const office = await post('/api/locations', { name: 'Reloc office' });
    await post('/api/assets', { name: 'Reloc laptop', code: 'LAP-97401', locationId: office.id });
    const { session } = await post('/api/inventory', {
      name: 'Reloc check',
      locationId: store.id,
    });

    await page.goto(`/inventory/${session.id}`);
    const manual = page.getByPlaceholder('LAP-00001 nebo sériové číslo, EAN…');
    await manual.fill('LAP-97401');
    await manual.press('Enter');

    const row = page.getByRole('listitem').filter({ hasText: 'LAP-97401' });
    await expect(row).toContainText('nalezeno v Reloc store, vedeno v Reloc office');
    await expect(page.getByText(/našel jinde, než je v evidenci/)).toBeVisible();
    await page.screenshot({
      path: process.env.SHOT ?? 'test-results/relocate.png',
      fullPage: true,
    });

    await row.getByRole('button', { name: 'Přesunout sem' }).click();
    await expect(page.getByText('Přesunuto: 1')).toBeVisible();
    // Now inside the scope: listed as found, no longer flagged.
    await expect(page.getByText(/našel jinde/)).toHaveCount(0);
    const asset = await (await page.request.get('/api/assets/LAP-97401')).json();
    expect(asset.asset.locationId).toBe(store.id);
  });
});
