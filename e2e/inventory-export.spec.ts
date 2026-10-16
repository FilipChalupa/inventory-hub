import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { devLogin } from './helpers.js';

test.describe('inventory export', () => {
  test('downloads the report as CSV and prints without controls', async ({ page }) => {
    await devLogin(page);
    const post = async (path: string, body: unknown) =>
      (
        await page.request.post(path, {
          headers: { 'content-type': 'application/json' },
          data: JSON.stringify(body),
        })
      ).json();
    await post('/api/assets', { name: 'Export A', code: 'LAP-97101' });
    await post('/api/assets', { name: 'Export B', code: 'LAP-97102' });
    const { session } = await post('/api/inventory', {
      name: 'Export check',
      assetCodes: ['LAP-97101', 'LAP-97102'],
    });
    await post(`/api/inventory/${session.id}/scan`, { code: 'LAP-97101' });

    await page.goto(`/inventory/${session.id}`);
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export CSV' }).click();
    const file = await (await download).path();
    const csv = readFileSync(file!, 'utf8');
    expect(csv).toContain('found,LAP-97101,Export A');
    expect(csv).toContain('missing,LAP-97102,Export B');

    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('button', { name: 'Tisk / PDF' })).toBeHidden();
    await expect(page.getByPlaceholder('LAP-00001 nebo sériové číslo, EAN…')).toBeHidden();
    await expect(page.getByText(/^Vytištěno /)).toBeVisible();
    await page.screenshot({
      path: process.env.SHOT ?? 'test-results/inventory-print.png',
      fullPage: true,
    });
  });
});
