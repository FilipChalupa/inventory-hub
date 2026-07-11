import { lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assetEvents } from '../db/schema.js';

/**
 * GDPR retention: deletes audit-log (asset event) history older than
 * `retentionDays`. Returns the number of rows removed. A no-op guard against
 * accidental wipes: a non-positive retention deletes nothing.
 */
export function pruneOldAuditEvents(db: Db, retentionDays: number, now: Date = new Date()): number {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const result = db.delete(assetEvents).where(lt(assetEvents.occurredAt, cutoff)).run();
  return result.changes;
}
