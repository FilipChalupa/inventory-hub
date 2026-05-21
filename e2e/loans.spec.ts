import { expect, test, type Page } from '@playwright/test';
import { devLogin } from './helpers.js';

async function createAsset(page: Page, name: string, code: string): Promise<void> {
  const res = await page.request.post('/api/assets', {
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify({ name, code }),
  });
  expect(res.ok()).toBeTruthy();
}

test.describe('loans', () => {
  test.beforeEach(async ({ page }) => {
    await devLogin(page);
  });

  test('create a loan via API, return one item OK and one damaged via UI', async ({
    page,
  }) => {
    // Self-contained: create our own assets so the test doesn't depend on
    // the order other E2E specs ran in.
    await createAsset(page, 'Loan Item A', 'LAP-91001');
    await createAsset(page, 'Loan Item B', 'LAP-91002');

    const createRes = await page.request.post('/api/loans', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({
        borrowerName: 'E2E Borrower',
        borrowerContact: 'borrower@example.com',
        assetCodes: ['LAP-91001', 'LAP-91002'],
      }),
    });
    expect(createRes.ok()).toBeTruthy();
    const { id: loanId } = (await createRes.json()) as { id: string };

    await page.goto(`/loans/${loanId}`);
    await expect(page.getByRole('heading', { name: 'E2E Borrower' })).toBeVisible();

    // Return the first item OK.
    await page.getByRole('button', { name: 'Vrátit' }).first().click();
    await page.getByRole('button', { name: /Potvrdit vrácení/ }).click();
    await expect(page.getByText(/vráceno /)).toBeVisible();

    // Return the second item as damaged.
    await page.getByRole('button', { name: 'Vrátit' }).first().click();
    await page.locator('select').selectOption('damaged');
    await page.getByRole('button', { name: /Potvrdit vrácení/ }).click();
    await expect(page.getByText(/poškozeno/i)).toBeVisible();
  });

  test('overdue badge highlights past-due loans', async ({ page }) => {
    await createAsset(page, 'Overdue Item', 'LAP-92001');
    const expected = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const createRes = await page.request.post('/api/loans', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({
        borrowerName: 'Overdue Customer',
        expectedReturnAt: expected,
        assetCodes: ['LAP-92001'],
      }),
    });
    expect(createRes.ok()).toBeTruthy();

    await page.goto('/loans');
    const row = page.locator('li').filter({ hasText: 'Overdue Customer' });
    await expect(row).toBeVisible();
    // The "overdue" badge is a small red span, not just any element
    // containing the substring (which would also match the borrower name).
    await expect(row.locator('span.bg-red-100', { hasText: 'overdue' })).toBeVisible();
  });
});
