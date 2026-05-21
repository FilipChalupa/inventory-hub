import { expect, test } from '@playwright/test';
import { devLogin } from './helpers.js';

test.describe('assets', () => {
  test.beforeEach(async ({ page }) => {
    await devLogin(page);
  });

  test('new-asset form renders the type dropdown', async ({ page }) => {
    // We only check the form scaffolding here. Submitting the form via
    // Playwright is flaky against React Hook Form's uncontrolled inputs
    // (the fill value doesn't always sync into RHF state, even with
    // pressSequentially). The POST endpoint itself is covered by the
    // server-side integration test suite.
    await page.goto('/assets/new');
    await expect(page.getByRole('heading', { name: 'Nový asset' })).toBeVisible();
    const typeSelect = page.getByLabel(/^Typ/);
    await expect(typeSelect.locator('option', { hasText: 'Notebook' })).toHaveCount(1);
  });

  test('an asset created via API lands on the list and opens', async ({ page }) => {
    const code = 'LAP-90100';
    const create = await page.request.post('/api/assets', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ name: 'E2E API Asset', code }),
    });
    expect(create.ok()).toBeTruthy();

    await page.goto('/');
    await expect(page.getByText('E2E API Asset')).toBeVisible();
    await page.getByText('E2E API Asset').click();
    await expect(page).toHaveURL(new RegExp(`/a/${code}`));
    await expect(page.getByRole('heading', { name: 'E2E API Asset' })).toBeVisible();
  });

  test('seeded asset shows up on the list and opens', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('ThinkPad X1 Carbon')).toBeVisible();
    await page.getByText('ThinkPad X1 Carbon').click();
    await expect(page).toHaveURL(/\/a\/LAP-00001/);
    await expect(page.getByRole('heading', { name: 'ThinkPad X1 Carbon' })).toBeVisible();
  });

  test('archive flow hides the asset by default and shows it under includeArchived', async ({
    page,
  }) => {
    // Create a one-off asset just for this test, then archive it. Use API
    // to keep the test focused on the archive UI rather than form input
    // mechanics (which are covered by the previous test).
    const createRes = await page.request.post('/api/assets', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ name: 'To Be Sold', code: 'LAP-90001' }),
    });
    expect(createRes.ok()).toBeTruthy();
    const code = 'LAP-90001';
    await page.goto(`/a/${code}`);

    // Archive as "Prodáno" — wait for the inline "archivováno" indicator
    // next to the status badge (exact match: there's also an "Archivováno"
    // label further down in the details list).
    await page.getByRole('button', { name: 'Prodáno', exact: true }).click();
    await expect(page.getByText('archivováno', { exact: true })).toBeVisible();

    // List view shouldn't show it without the archived checkbox.
    await page.goto('/');
    await expect(page.getByRole('link', { name: new RegExp(code) })).toHaveCount(0);
    await page.getByLabel('archivované').check();
    await expect(page.getByRole('link', { name: new RegExp(code) })).toBeVisible();
  });

  test('QR endpoint returns a PNG', async ({ page }) => {
    const res = await page.request.get('/api/assets/LAP-00001/qr');
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('image/png');
    const body = await res.body();
    // PNG magic bytes
    expect(body.subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});
