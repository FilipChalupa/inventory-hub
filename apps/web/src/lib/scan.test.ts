import { describe, it, expect } from 'vitest';
import { parseScannedValue } from './scan.js';

describe('parseScannedValue', () => {
  it('extracts the code from a full URL', () => {
    expect(parseScannedValue('https://inventory.example.com/a/LAP-00001')).toBe('LAP-00001');
  });

  it('extracts and uppercases from a URL with a lowercase code', () => {
    expect(parseScannedValue('http://localhost:5173/a/lap-00001')).toBe('LAP-00001');
  });

  it('accepts a bare code', () => {
    expect(parseScannedValue('LAP-00001')).toBe('LAP-00001');
  });

  it('uppercases a bare lowercase code', () => {
    expect(parseScannedValue('lap-00001')).toBe('LAP-00001');
  });

  it('accepts an org-prefixed code', () => {
    expect(parseScannedValue('ACME-LAP-00001')).toBe('ACME-LAP-00001');
  });

  it('rejects empty / whitespace input', () => {
    expect(parseScannedValue('   ')).toBeNull();
    expect(parseScannedValue('')).toBeNull();
  });

  it('rejects free-text URLs without /a/<code>', () => {
    expect(parseScannedValue('https://example.com/help')).toBeNull();
  });

  it('rejects strings with invalid characters', () => {
    expect(parseScannedValue('LAP_00001')).toBeNull();
    expect(parseScannedValue('hello world')).toBeNull();
  });

  it('rejects strings that are too short', () => {
    expect(parseScannedValue('LA')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(parseScannedValue('  LAP-00001  ')).toBe('LAP-00001');
  });
});
