import { describe, it, expect } from 'vitest';
import { escapeLike } from './search.js';

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape char', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('c:\\path')).toBe('c:\\\\path');
    expect(escapeLike('%_\\')).toBe('\\%\\_\\\\');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLike('MacBook Pro')).toBe('MacBook Pro');
    expect(escapeLike('')).toBe('');
  });
});
