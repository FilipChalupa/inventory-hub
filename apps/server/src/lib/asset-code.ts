import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assets } from '../db/schema.js';

/**
 * Generates the next asset code for a given category prefix.
 * Format: [<ORG>-]<KAT>-<SEQ> where SEQ is zero-padded to 5 digits.
 * Org prefix is read from org settings and may be null.
 */
export function generateAssetCode(
  db: Db,
  categoryPrefix: string,
  orgPrefix: string | null,
): string {
  const prefix = orgPrefix ? `${orgPrefix}-${categoryPrefix}-` : `${categoryPrefix}-`;

  const row = db
    .select({
      maxSeq: sql<number | null>`
        COALESCE(
          MAX(CAST(SUBSTR(code, ${prefix.length + 1}) AS INTEGER)),
          0
        )
      `,
    })
    .from(assets)
    .where(sql`code LIKE ${prefix + '%'} AND code GLOB ${prefix + '[0-9]*'}`)
    .get();

  const next = (row?.maxSeq ?? 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}
