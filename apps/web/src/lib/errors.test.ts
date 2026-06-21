import { describe, it, expect } from 'vitest';
import { errorMessage } from './errors.js';

describe('errorMessage', () => {
  it('reads the message off an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('accepts a non-empty string', () => {
    expect(errorMessage('nope')).toBe('nope');
  });

  it('reads message off a plain object', () => {
    expect(errorMessage({ message: 'from object' })).toBe('from object');
  });

  it('falls back for null / undefined / empty (never throws)', () => {
    expect(errorMessage(null)).toBe('Něco se nepovedlo');
    expect(errorMessage(undefined)).toBe('Něco se nepovedlo');
    expect(errorMessage(new Error(''))).toBe('Něco se nepovedlo');
    expect(errorMessage({}, 'vlastní')).toBe('vlastní');
  });
});
