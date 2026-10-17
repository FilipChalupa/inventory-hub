import { beforeEach, describe, expect, it } from 'vitest';
import { isNetworkError, scanQueue } from './scanQueue.js';

describe('scanQueue', () => {
  beforeEach(() => localStorage.clear());

  it('queues, dedupes, completes and fails scans per session', () => {
    expect(scanQueue.enqueue('s1', 'LAP-1')).toBe(true);
    expect(scanQueue.enqueue('s1', 'LAP-1')).toBe(false);
    expect(scanQueue.enqueue('s1', 'SN-9')).toBe(true);
    expect(scanQueue.get('s2').pending).toEqual([]);

    const [a, b] = scanQueue.get('s1').pending;
    scanQueue.done('s1', a!.id);
    scanQueue.fail('s1', b!.id, 'not found');
    expect(scanQueue.get('s1')).toMatchObject({
      pending: [],
      failed: [{ code: 'SN-9', error: 'not found' }],
    });
    scanQueue.clearFailed('s1');
    expect(localStorage.getItem('ih.scanQueue.s1')).toBeNull();
  });

  it('survives a reload (state lives in localStorage)', () => {
    scanQueue.enqueue('s1', 'LAP-2', 'u1', {
      scannedAt: new Date('2026-01-01T10:00:00Z'),
      locationId: 'loc-1',
    });
    const raw = localStorage.getItem('ih.scanQueue.s1')!;
    expect(JSON.parse(raw).pending[0]).toMatchObject({
      code: 'LAP-2',
      scannedAt: '2026-01-01T10:00:00.000Z',
      locationId: 'loc-1',
    });
  });

  it('returns a stable snapshot while nothing changes', () => {
    scanQueue.enqueue('s1', 'LAP-3');
    expect(scanQueue.get('s1')).toBe(scanQueue.get('s1'));
  });

  it('tells network failures from server answers', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new Error('Asset nenalezen'))).toBe(false);
  });

  it("keeps each user's scans to themselves on a shared device", () => {
    scanQueue.enqueue('s1', 'LAP-5', 'alice');
    scanQueue.enqueue('s1', 'LAP-5', 'bob'); // same code, different person: both kept
    scanQueue.enqueue('s1', 'LAP-6', 'bob');
    expect(scanQueue.pendingFor('s1', 'alice').map((p) => p.code)).toEqual(['LAP-5']);
    expect(scanQueue.pendingFor('s1', 'bob').map((p) => p.code)).toEqual(['LAP-5', 'LAP-6']);
  });
});
