import { expect, test } from '@playwright/test';
import { SERVER_URL, devLogin } from './helpers.js';

test.describe('authorization', () => {
  test('a member can read but cannot mutate the inventory', async ({ page }) => {
    await devLogin(page, 'member@example.com');

    // Reads are allowed for every authenticated role.
    const read = await page.request.get(`${SERVER_URL}/api/assets`);
    expect(read.status()).toBe(200);

    // Creating an asset is an admin/operator action — a member is rejected
    // with 403 (the request rides the member's session cookie + CSRF origin).
    const create = await page.request.post(`${SERVER_URL}/api/assets`, {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ name: 'Nope', typeId: null, code: 'LAP-90001' }),
    });
    expect(create.status()).toBe(403);
  });
});
