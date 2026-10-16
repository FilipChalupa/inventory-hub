import { expect, test } from '@playwright/test';
import { devLogin } from './helpers.js';

test.describe('inventory offline', () => {
  test('scans made offline are queued and sent once back online', async ({ page, context }) => {
    await devLogin(page);
    const post = async (path: string, body: unknown) =>
      (
        await page.request.post(path, {
          headers: { 'content-type': 'application/json' },
          data: JSON.stringify(body),
        })
      ).json();
    await post('/api/assets', { name: 'Offline A', code: 'LAP-97001' });
    await post('/api/assets', { name: 'Offline B', code: 'LAP-97002' });
    await post('/api/assets/LAP-97002/external-ids', { kind: 'serial', value: 'OFF-SN-2' });
    const { session } = await post('/api/inventory', {
      name: 'Offline stock-take',
      assetCodes: ['LAP-97001', 'LAP-97002'],
    });

    await page.goto(`/inventory/${session.id}`);
    const manual = page.getByPlaceholder('LAP-00001 nebo sériové číslo, EAN…');
    const found = page.getByText('Nalezeno', { exact: true }).first().locator('..');
    await expect(found).toHaveText(/^0/);

    await context.setOffline(true);
    await manual.fill('LAP-97001');
    await manual.press('Enter'); // like a keyboard-wedge barcode reader
    await expect(page.getByText('Offline — „LAP-97001" uložen')).toBeVisible();
    await manual.fill('off sn 2'); // a serial, resolved by the server later
    await manual.press('Enter'); // like a keyboard-wedge barcode reader
    await manual.fill('NOPE-404');
    await manual.press('Enter'); // like a keyboard-wedge barcode reader
    await expect(page.getByRole('status').filter({ hasText: '3 skeny čekají' })).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByRole('status').filter({ hasText: 'čeká' })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(found).toHaveText(/^2/);
    await expect(page.getByText('Tyto offline skeny server odmítl:')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'NOPE-404' })).toBeVisible();
    await page.getByRole('button', { name: 'Skrýt' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'NOPE-404' })).toHaveCount(0);
  });
});
