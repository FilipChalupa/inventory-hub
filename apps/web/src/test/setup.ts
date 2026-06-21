import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Pin the locale to Czech so component tests are deterministic regardless of
// the test environment's navigator.language (happy-dom reports en-US).
beforeEach(() => {
  try {
    localStorage.setItem('ih.locale', 'cs');
  } catch {
    // ignore
  }
});

// Unmount React trees between tests so component state (and our module-level
// toast/confirm stores' subscribers) don't leak across cases.
afterEach(() => {
  cleanup();
});
