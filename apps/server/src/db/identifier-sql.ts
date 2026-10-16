import { sql, type SQL } from 'drizzle-orm';

/**
 * SQL form of {@link normalizeIdentifier}: ASCII-uppercase with spaces and
 * the separators - _ . : / removed. Written with literal (not bound)
 * arguments so the very same expression can back an index — SQLite only
 * uses an expression index when the query repeats the expression exactly.
 */
export function normIdentifierSql(col: unknown): SQL {
  return sql`upper(replace(replace(replace(replace(replace(replace(${col}, ' ', ''), '-', ''), '_', ''), '.', ''), ':', ''), '/', ''))`;
}

/**
 * Identifier normalization shared by lookups: "ab-12 3" → "AB123". Only
 * ASCII letters are uppercased, matching SQLite's upper(), so stored and
 * queried forms always agree.
 */
export function normalizeIdentifier(v: string): string {
  return v
    .trim()
    .replace(/[ \-_.:/]/g, '')
    .replace(/[a-z]/g, (c) => c.toUpperCase());
}
