import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount React trees between tests so component state (and our module-level
// toast/confirm stores' subscribers) don't leak across cases.
afterEach(() => {
  cleanup();
});
