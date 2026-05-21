import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildAuthorizationUrl,
  generatePkcePair,
  generateState,
  type GoogleConfig,
} from './google-oauth.js';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('generatePkcePair', () => {
  it('produces a verifier that hashes (S256) to the challenge', () => {
    const { verifier, challenge } = generatePkcePair();
    const expected = base64url(createHash('sha256').update(verifier).digest());
    expect(challenge).toBe(expected);
  });

  it('uses URL-safe base64 without padding', () => {
    const { verifier, challenge } = generatePkcePair();
    for (const s of [verifier, challenge]) {
      expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(s).not.toContain('=');
      expect(s).not.toContain('+');
      expect(s).not.toContain('/');
    }
  });

  it('returns a verifier in the RFC 7636 length range (43–128 chars)', () => {
    const { verifier } = generatePkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('produces a different pair on each call', () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});

describe('generateState', () => {
  it('returns a URL-safe random string with enough entropy', () => {
    const state = generateState();
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(state.length).toBeGreaterThanOrEqual(32);
  });

  it('is unique across calls', () => {
    expect(generateState()).not.toBe(generateState());
  });
});

describe('buildAuthorizationUrl', () => {
  const config: GoogleConfig = {
    clientId: 'client-123.apps.googleusercontent.com',
    clientSecret: 'secret-not-leaked',
    redirectUrl: 'https://app.example.com/auth/google/callback',
  };

  it('points at the Google OAuth endpoint', () => {
    const url = new URL(buildAuthorizationUrl(config, 'state-x', 'challenge-y'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  });

  it('includes all PKCE + OIDC parameters', () => {
    const url = new URL(buildAuthorizationUrl(config, 'state-x', 'challenge-y'));
    const params = url.searchParams;
    expect(params.get('client_id')).toBe(config.clientId);
    expect(params.get('redirect_uri')).toBe(config.redirectUrl);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe('openid email profile');
    expect(params.get('state')).toBe('state-x');
    expect(params.get('code_challenge')).toBe('challenge-y');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('access_type')).toBe('online');
    expect(params.get('prompt')).toBe('select_account');
  });

  it('does NOT leak the client secret into the URL', () => {
    const url = buildAuthorizationUrl(config, 'state', 'challenge');
    expect(url).not.toContain(config.clientSecret);
  });

  it('properly encodes special characters in state and challenge', () => {
    const url = new URL(buildAuthorizationUrl(config, 'a b&c', 'x/y+z'));
    expect(url.searchParams.get('state')).toBe('a b&c');
    expect(url.searchParams.get('code_challenge')).toBe('x/y+z');
  });
});
