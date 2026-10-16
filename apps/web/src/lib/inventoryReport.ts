import type { InventoryReport, ScanResult } from './api.js';

/**
 * Applies a scan response to a cached report: the scanned asset's row moves
 * from "missing" into "found" (or joins "unexpected"), and the counts come
 * from the server. Lets each scan return a few hundred bytes instead of the
 * whole report.
 */
export function applyScanToReport(report: InventoryReport, scan: ScanResult): InventoryReport {
  const without = (list: InventoryReport['found']) => list.filter((a) => a.id !== scan.asset.id);
  const insertSorted = (list: InventoryReport['found']) =>
    [...without(list), scan.asset].sort((a, b) => a.code.localeCompare(b.code));
  return {
    counts: scan.counts,
    missing: without(report.missing),
    found: scan.list === 'found' ? insertSorted(report.found) : without(report.found),
    unexpected:
      scan.list === 'unexpected' ? insertSorted(report.unexpected) : without(report.unexpected),
  };
}
