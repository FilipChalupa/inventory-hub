import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetUserOnDevice,
  isSharedDevice,
  readLastMe,
  rememberMe,
  setSharedDevice,
} from './deviceSession.js';

const me = {
  authenticated: true as const,
  user: { id: 'u1', email: 'a@x.cz', name: 'A', role: 'operator' as const, imageUrl: null },
};

describe('deviceSession', () => {
  beforeEach(() => localStorage.clear());

  it('remembers the last identity for offline start', () => {
    rememberMe(me);
    expect(readLastMe()).toEqual(me);
  });

  it('forgets it when the server says signed out, or after the session lifetime', () => {
    rememberMe(me);
    rememberMe({ authenticated: false });
    expect(readLastMe()).toBeUndefined();

    rememberMe(me);
    expect(readLastMe(Date.now() + 31 * 24 * 60 * 60 * 1000)).toBeUndefined();
  });

  it('never remembers anyone on a shared device', () => {
    rememberMe(me);
    setSharedDevice(true);
    expect(isSharedDevice()).toBe(true);
    expect(readLastMe()).toBeUndefined(); // existing memory wiped
    rememberMe(me);
    expect(localStorage.getItem('ih.lastMe')).toBeNull();
    setSharedDevice(false);
    rememberMe(me);
    expect(readLastMe()).toEqual(me);
  });

  it('forgetUserOnDevice clears the remembered identity', async () => {
    rememberMe(me);
    await forgetUserOnDevice();
    expect(readLastMe()).toBeUndefined();
  });
});
