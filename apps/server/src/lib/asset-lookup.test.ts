import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { setupTestServer, type TestServer } from './test-server.js';
import { assetExternalIds, assetFieldValues, assets } from '../db/schema.js';
import { normIdentifierSql, normalizeIdentifier } from '../db/identifier-sql.js';
import { lookupAssetsByIdentifier } from './asset-lookup.js';

let server: TestServer;
beforeEach(() => {
  server = setupTestServer();
});
afterEach(() => server.close());

function insertAsset(code: string, customFields: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  server.db.insert(assets).values({ id, code, name: code, customFields }).run();
  return id;
}

/** EXPLAIN QUERY PLAN detail lines for a drizzle query. */
function plan(query: { toSQL: () => { sql: string; params: unknown[] } }): string {
  const { sql: text, params } = query.toSQL();
  return server.sqlite
    .prepare(`EXPLAIN QUERY PLAN ${text}`)
    .all(...(params as never[]))
    .map((r) => (r as { detail: string }).detail)
    .join(' | ');
}

describe('identifier normalization', () => {
  it('JS and SQL normalize identically (ASCII-only uppercase)', () => {
    for (const v of ['ab-12 3', 'x_y.z:w/v', 'čšř-ab', 'MiXeD-07']) {
      const sqlNorm = server.db.get<{ n: string }>(
        sql`SELECT ${normIdentifierSql(sql`${v}`)} AS n`,
      );
      expect(sqlNorm.n, v).toBe(normalizeIdentifier(v));
    }
  });
});

describe('asset_field_values triggers', () => {
  it('track inserts, custom-field updates and deletes', () => {
    const id = insertAsset('LAP-1', { inv: 'INV/7', count: 3, nested: { a: 1 }, flag: true });
    const rows = () =>
      server.db
        .select({
          key: assetFieldValues.key,
          value: assetFieldValues.value,
          n: assetFieldValues.valueNorm,
        })
        .from(assetFieldValues)
        .where(eq(assetFieldValues.assetId, id))
        .all()
        .sort((a, b) => a.key.localeCompare(b.key));
    // Scalars only (text / integer / real).
    expect(rows()).toEqual([
      { key: 'count', value: '3', n: '3' },
      { key: 'inv', value: 'INV/7', n: 'INV7' },
    ]);
    server.db
      .update(assets)
      .set({ customFields: { inv: 'new-1' } })
      .where(eq(assets.id, id))
      .run();
    expect(rows()).toEqual([{ key: 'inv', value: 'new-1', n: 'NEW1' }]);
    // Updating another column leaves them alone.
    server.db.update(assets).set({ name: 'renamed' }).where(eq(assets.id, id)).run();
    expect(rows()).toHaveLength(1);
    server.db.delete(assets).where(eq(assets.id, id)).run();
    expect(rows()).toEqual([]);
  });
});

describe('lookup uses indexes', () => {
  it('for codes, external ids and custom fields', () => {
    const id = insertAsset('LAP-00042', { inv: 'Q-9' });
    server.db.insert(assetExternalIds).values({ assetId: id, kind: 'serial', value: 'SN-1' }).run();
    const wanted = 'X';
    expect(
      plan(
        server.db
          .select({ id: assets.id })
          .from(assets)
          .where(sql`${normIdentifierSql(assets.code)} = ${wanted}`),
      ),
    ).toContain('assets_code_norm_idx');
    expect(
      plan(
        server.db
          .select({ id: assetExternalIds.id })
          .from(assetExternalIds)
          .where(sql`${normIdentifierSql(assetExternalIds.value)} = ${wanted}`),
      ),
    ).toContain('asset_external_ids_value_norm_idx');
    expect(
      plan(server.db.select().from(assetFieldValues).where(eq(assetFieldValues.valueNorm, wanted))),
    ).toContain('asset_field_values_value_norm_idx');

    expect(lookupAssetsByIdentifier(server.db, 'lap 00042')[0]!.matchedOn[0]!.field).toBe('code');
    expect(lookupAssetsByIdentifier(server.db, 'sn1')[0]!.matchedOn[0]).toMatchObject({
      field: 'externalId',
      key: 'serial',
    });
    expect(lookupAssetsByIdentifier(server.db, 'q 9')[0]!.matchedOn[0]).toMatchObject({
      field: 'customField',
      key: 'inv',
      value: 'Q-9',
    });
  });
});
