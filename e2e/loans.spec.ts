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

    // Return the first item OK. `exact` so we don't hit "Vrátit vše".
    await page.getByRole('button', { name: 'Vrátit', exact: true }).first().click();
    await page.getByRole('button', { name: /Potvrdit vrácení/ }).click();
    await expect(page.getByText(/vráceno /)).toBeVisible();

    // Return the second item as damaged.
    await page.getByRole('button', { name: 'Vrátit', exact: true }).first().click();
    await page.locator('select').selectOption('damaged');
    await page.getByRole('button', { name: /Potvrdit vrácení/ }).click();
    await expect(page.getByText(/poškozeno/i)).toBeVisible();
  });

  test('plan a future loan, then start it from the detail page', async ({ page }) => {
    await createAsset(page, 'Planned Item', 'LAP-93001');
    const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const createRes = await page.request.post('/api/loans', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({
        borrowerName: 'Planned Borrower',
        loanedAt: start,
        assetCodes: ['LAP-93001'],
      }),
    });
    expect(createRes.ok()).toBeTruthy();
    const { id: loanId } = (await createRes.json()) as { id: string };

    await page.goto(`/loans/${loanId}`);
    await expect(page.getByText('Naplánováno')).toBeVisible();

    await page.getByRole('button', { name: 'Zahájit výpůjčku' }).click();
    await expect(page.getByRole('button', { name: 'Zahájit výpůjčku' })).toBeHidden();
    await expect(page.getByText('Naplánováno')).toBeHidden();
  });

  test('cancel a planned reservation from the detail page', async ({ page }) => {
    await createAsset(page, 'Cancelable Item', 'LAP-93101');
    const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const createRes = await page.request.post('/api/loans', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({
        borrowerName: 'Cancel Borrower',
        loanedAt: start,
        assetCodes: ['LAP-93101'],
      }),
    });
    const { id: loanId } = (await createRes.json()) as { id: string };

    await page.goto(`/loans/${loanId}`);
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Zrušit rezervaci' }).click();
    await expect(page).toHaveURL(/\/loans$/);
    await expect(page.locator('li').filter({ hasText: 'Cancel Borrower' })).toHaveCount(0);
  });

  test('return all open items at once', async ({ page }) => {
    await createAsset(page, 'Bulk A', 'LAP-93201');
    await createAsset(page, 'Bulk B', 'LAP-93202');
    const createRes = await page.request.post('/api/loans', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({
        borrowerName: 'Bulk Borrower',
        assetCodes: ['LAP-93201', 'LAP-93202'],
      }),
    });
    const { id: loanId } = (await createRes.json()) as { id: string };

    await page.goto(`/loans/${loanId}`);
    await page.getByRole('button', { name: 'Vrátit vše (2)', exact: true }).click();
    await page.getByRole('button', { name: 'Vrátit vše (2) jako v pořádku', exact: true }).click();
    await expect(page.getByText(/vráceno /).first()).toBeVisible();
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
