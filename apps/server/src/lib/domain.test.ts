import { describe, it, expect } from 'vitest';
import { emailDomain, matchAllowedDomain } from './domain.js';

describe('emailDomain', () => {
  it('extracts and lowercases the domain', () => {
    expect(emailDomain('Foo@Acme.COM')).toBe('acme.com');
  });

  it('returns null for malformed addresses', () => {
    expect(emailDomain('no-at')).toBeNull();
    expect(emailDomain('trailing@')).toBeNull();
  });
});

describe('matchAllowedDomain', () => {
  const allowed = [
    { domain: 'acme.com', defaultRole: 'member' as const },
    { domain: 'partners.acme.com', defaultRole: 'auditor' as const },
  ];

  it('matches exact domain', () => {
    expect(matchAllowedDomain('john@acme.com', allowed)).toEqual(allowed[0]);
  });

  it('does NOT match subdomain when only parent is allowed', () => {
    expect(matchAllowedDomain('john@eng.acme.com', allowed)).toBeNull();
  });

  it('matches separately listed subdomain', () => {
    expect(matchAllowedDomain('jane@partners.acme.com', allowed)).toEqual(allowed[1]);
  });

  it('returns null for unrelated domain', () => {
    expect(matchAllowedDomain('foo@other.io', allowed)).toBeNull();
  });
});
