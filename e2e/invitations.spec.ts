import { expect, test } from '@playwright/test';
import { devLogin } from './helpers.js';

test.describe('invitations', () => {
  test('admin invites a user, invitee accepts and lands logged in', async ({
    browser,
  }) => {
    // 1. Admin creates an invitation.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await devLogin(adminPage);

    const invited = `e2e-invitee+${Date.now()}@example.com`;
    const createRes = await adminPage.request.post('/api/invitations', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ email: invited, role: 'operator' }),
    });
    expect(createRes.ok()).toBeTruthy();
    const { acceptUrl } = (await createRes.json()) as { acceptUrl: string };
    expect(acceptUrl).toMatch(/\/accept-invite\?token=/);
    const token = new URL(acceptUrl).searchParams.get('token')!;

    await adminContext.close();

    // 2. Invitee opens the accept-invite link in a fresh browser session.
    const inviteeContext = await browser.newContext();
    const inviteePage = await inviteeContext.newPage();
    await inviteePage.goto(`/accept-invite?token=${encodeURIComponent(token)}`);

    // Card shows the invitee's email and role.
    await expect(inviteePage.getByText(invited)).toBeVisible();
    await expect(inviteePage.getByText('operator')).toBeVisible();

    // Fill name and accept (this form uses controlled inputs, so fill works fine).
    await inviteePage.getByPlaceholder('Jan Novák').fill('Nová Posila');
    await inviteePage.getByRole('button', { name: /Přijmout pozvánku/ }).click();

    // Logged in → lands on the home dashboard.
    await expect(inviteePage.getByRole('heading', { name: 'Dnes' })).toBeVisible({
      timeout: 10_000,
    });

    await inviteeContext.close();
  });
});
