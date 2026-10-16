import { describe, expect, it } from 'vitest';
import type { InventoryReport, InventoryReportAsset } from './api.js';
import { applyScanToReport } from './inventoryReport.js';

const row = (code: string, scannedAt: string | null = null): InventoryReportAsset => ({
  id: code,
  code,
  name: code,
  status: 'in_stock' as InventoryReportAsset['status'],
  locationId: null,
  scannedAt,
  note: null,
});

const base: InventoryReport = {
  counts: { expected: 3, found: 1, missing: 2, unexpected: 0 },
  found: [row('A', 't')],
  missing: [row('B'), row('C')],
  unexpected: [],
};

describe('applyScanToReport', () => {
  it('moves a found asset out of missing, keeping code order', () => {
    const next = applyScanToReport(base, {
      result: 'found',
      list: 'found',
      asset: row('C', 't2'),
      counts: { expected: 3, found: 2, missing: 1, unexpected: 0 },
    });
    expect(next.found.map((a) => a.code)).toEqual(['A', 'C']);
    expect(next.missing.map((a) => a.code)).toEqual(['B']);
    expect(next.counts.found).toBe(2);
  });

  it('adds an out-of-scope scan to unexpected once', () => {
    const scan = {
      result: 'unexpected' as const,
      list: 'unexpected' as const,
      asset: row('Z', 't'),
      counts: { expected: 3, found: 1, missing: 2, unexpected: 1 },
    };
    const once = applyScanToReport(base, scan);
    const twice = applyScanToReport(once, { ...scan, result: 'already' });
    expect(twice.unexpected.map((a) => a.code)).toEqual(['Z']);
    expect(twice.missing).toHaveLength(2);
  });
});
