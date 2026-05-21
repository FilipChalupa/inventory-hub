import type { Page } from '@playwright/test';

const SERVER_PORT = process.env.E2E_SERVER_PORT ?? '3101';
export const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

/**
 * Logs in via the dev-login form. Waits for the assets header to be
 * visible — that's the strongest signal that the auth state propagated.
 */
export async function devLogin(page: Page, email = 'admin@example.com'): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('admin@example.com').fill(email);
  await page.getByRole('button', { name: /Dev login/i }).click();
  await page.getByRole('heading', { name: 'Assety' }).waitFor({ timeout: 15_000 });
}

/**
 * Hits a backend endpoint directly via the page's browser context so cookies
 * + CSRF Origin are taken care of automatically.
 */
export async function apiPost(
  page: Page,
  path: string,
  body: unknown,
): Promise<Response> {
  return page.request.post(`${SERVER_URL}${path}`, {
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify(body),
  });
}
