import { expect, test } from '@playwright/test';
import { devLogin } from './helpers.js';

test.describe('inventory live updates', () => {
  test('a scan from another device shows up without reloading', async ({ page, browser }) => {
    await devLogin(page);
    const post = async (path: string, body: unknown) =>
      (
        await page.request.post(path, {
          headers: { 'content-type': 'application/json' },
          data: JSON.stringify(body),
        })
      ).json();
    await post('/api/assets', { name: 'Live A', code: 'LAP-97501' });
    await post('/api/assets', { name: 'Live B', code: 'LAP-97502' });
    const { session } = await post('/api/inventory', {
      name: 'Live check',
      assetCodes: ['LAP-97501', 'LAP-97502'],
    });

    await page.goto(`/inventory/${session.id}`);
    const found = page.getByText('Nalezeno', { exact: true }).first().locator('..');
    await expect(found).toHaveText(/^0/);

    // A colleague on another device (separate browser context) scans one.
    const other = await browser.newContext({ locale: 'cs-CZ' });
    const colleague = await other.newPage();
    await devLogin(colleague);
    await colleague.request.post(`/api/inventory/${session.id}/scan`, {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ code: 'LAP-97502' }),
    });
    await other.close();

    await expect(found).toHaveText(/^1/, { timeout: 25_000 });
    // first(): it may also be listed in the comparison with another spec's session.
    await expect(page.getByRole('listitem').filter({ hasText: 'LAP-97502' }).first()).toBeVisible();
  });
});
