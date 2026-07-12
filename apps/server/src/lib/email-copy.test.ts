import { describe, it, expect } from 'vitest';
import { emailCopy } from './email-copy.js';

describe('emailCopy', () => {
  it('renders each template in Czech by default', () => {
    const c = emailCopy('cs');
    expect(
      c.invitation({ inviterName: 'A', inviterEmail: 'a@x', role: 'member', acceptUrl: 'u' })
        .subject,
    ).toMatch(/Pozvánka/);
    expect(c.reservationApproved({ name: 'A', itemCount: 2, period: 'p' }).subject).toMatch(
      /schválena/,
    );
    expect(c.reservationRejected({ name: 'A', itemCount: 1 }).subject).toMatch(/zamítnuta/);
    expect(
      c.weeklyReport({
        adminName: 'A',
        totalActive: 1,
        totalValue: '0',
        openLoans: 0,
        overdueLoans: 0,
      }).text,
    ).toMatch(/týdenní/);
  });

  it('renders each template in English when asked', () => {
    const e = emailCopy('en');
    expect(
      e.invitation({ inviterName: 'A', inviterEmail: 'a@x', role: 'member', acceptUrl: 'u' })
        .subject,
    ).toMatch(/Invitation/);
    expect(e.reservationApproved({ name: 'A', itemCount: 2, period: 'p' }).subject).toMatch(
      /approved/,
    );
    expect(e.reservationRejected({ name: 'A', itemCount: 1 }).subject).toMatch(/rejected/);
    expect(e.overdueBorrower({ borrowerName: 'A', dueDate: '2026-01-01' }).text).toMatch(/overdue/);
    expect(e.serviceDigest({ adminName: 'A', windowDays: 30, items: [] }).subject).toMatch(
      /service/,
    );
    expect(e.warrantyDigest({ adminName: 'A', windowDays: 30, items: [] }).subject).toMatch(
      /warranty/,
    );
  });

  it('localizes the role name in invitations', () => {
    const p = { inviterName: 'A', inviterEmail: 'a@x', role: 'operator' as const, acceptUrl: 'u' };
    expect(emailCopy('cs').invitation(p).text).toMatch(/operátor/);
    expect(emailCopy('en').invitation(p).text).toMatch(/operator/);
  });

  it('drops optional lines (URLs) when omitted', () => {
    const withUrl = emailCopy('en').reservationApproved({
      name: 'A',
      itemCount: 1,
      period: 'p',
      detailUrl: 'http://x/loans/1',
    });
    const without = emailCopy('en').reservationApproved({ name: 'A', itemCount: 1, period: 'p' });
    expect(withUrl.text).toMatch(/Details: http/);
    expect(without.text).not.toMatch(/Details:/);
  });

  it('builds localized admin-digest line items', () => {
    const cs = emailCopy('cs').overdueDigest({
      adminName: 'A',
      items: [{ borrowerName: 'Jan', expected: '2026-01-01', idShort: 'abcd1234' }],
    });
    expect(cs.text).toMatch(/- Jan: očekáváno 2026-01-01 \(id abcd1234\)/);
    const en = emailCopy('en').overdueDigest({
      adminName: 'A',
      items: [{ borrowerName: 'Jan', expected: '2026-01-01', idShort: 'abcd1234' }],
    });
    expect(en.text).toMatch(/- Jan: due 2026-01-01 \(id abcd1234\)/);
  });

  it('renders the asset-assigned notice in both locales', () => {
    const p = {
      name: 'A',
      assetCode: 'LAP-1',
      assetName: 'ThinkPad',
      detailUrl: 'http://x/a/LAP-1',
    };
    const cs = emailCopy('cs').assetAssigned(p);
    expect(cs.subject).toMatch(/přiřazen/);
    expect(cs.text).toMatch(/LAP-1 ThinkPad/);
    const en = emailCopy('en').assetAssigned(p);
    expect(en.subject).toMatch(/assigned/);
    expect(en.text).toMatch(/LAP-1 ThinkPad has been assigned/);
  });

  it('falls back to Czech for an undefined locale', () => {
    expect(
      emailCopy(undefined).reservationApproved({ name: 'A', itemCount: 1, period: 'p' }).subject,
    ).toMatch(/schválena/);
  });
});
