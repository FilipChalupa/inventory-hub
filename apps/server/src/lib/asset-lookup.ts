import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assetExternalIds, assets, type AssetRow } from '../db/schema.js';

export type LookupMatch = {
  field: 'code' | 'externalId' | 'customField';
  /** External-ID kind or custom-field key. */
  key?: string;
  value: string;
  /** Matched exactly as typed (not just after normalization). */
  exact: boolean;
};

/** Case- and separator-insensitive form of an identifier: "ab-12 3" → "AB123". */
export function normalizeIdentifier(v: string): string {
  return v.toUpperCase().replace(/[\s\-_.:/]/g, '');
}

const norm = (col: unknown) =>
  sql`upper(replace(replace(replace(replace(replace(replace(${col}, ' ', ''), '-', ''), '_', ''), '.', ''), ':', ''), '/', ''))`;

/**
 * Exact identifier lookup — "which asset has serial ABC123?". Matches the
 * asset code, any external ID (serial, EAN, SKU…) and scalar custom-field
 * values, ignoring case and separators, and says what matched. `kind`
 * restricts it to one external-ID kind. Never returns substring hits.
 * Exact-as-typed matches sort first, then live assets before archived ones.
 */
export function lookupAssetsByIdentifier(
  db: Db,
  value: string,
  kind?: string,
): { asset: AssetRow; matchedOn: LookupMatch[] }[] {
  const wanted = normalizeIdentifier(value.trim());
  if (!wanted) return [];
  const typed = value.trim();
  const hits = new Map<string, LookupMatch[]>();
  const add = (assetId: string, m: LookupMatch) =>
    hits.set(assetId, [...(hits.get(assetId) ?? []), m]);

  if (!kind) {
    const byCode = db
      .select({ id: assets.id, code: assets.code })
      .from(assets)
      .where(sql`${norm(assets.code)} = ${wanted}`)
      .all();
    for (const a of byCode) add(a.id, { field: 'code', value: a.code, exact: a.code === typed });
  }

  const byExternal = db
    .select({
      assetId: assetExternalIds.assetId,
      kind: assetExternalIds.kind,
      value: assetExternalIds.value,
    })
    .from(assetExternalIds)
    .where(
      and(
        sql`${norm(assetExternalIds.value)} = ${wanted}`,
        kind ? eq(assetExternalIds.kind, kind) : undefined,
      ),
    )
    .all();
  for (const e of byExternal) {
    add(e.assetId, { field: 'externalId', key: e.kind, value: e.value, exact: e.value === typed });
  }

  if (!kind) {
    const byCustom = db.all<{ id: string; key: string; value: string }>(
      sql`SELECT a.id AS id, je.key AS key, CAST(je.value AS TEXT) AS value
          FROM ${assets} a, json_each(a.custom_fields) je
          WHERE je.type IN ('text', 'integer', 'real')
            AND ${norm(sql`CAST(je.value AS TEXT)`)} = ${wanted}`,
    );
    for (const r of byCustom) {
      add(r.id, { field: 'customField', key: r.key, value: r.value, exact: r.value === typed });
    }
  }

  if (hits.size === 0) return [];
  return db
    .select()
    .from(assets)
    .where(inArray(assets.id, [...hits.keys()]))
    .all()
    .map((asset) => ({ asset, matchedOn: hits.get(asset.id)! }))
    .sort(
      (a, b) =>
        Number(b.matchedOn.some((m) => m.exact)) - Number(a.matchedOn.some((m) => m.exact)) ||
        Number(Boolean(a.asset.archivedAt)) - Number(Boolean(b.asset.archivedAt)),
    );
}
