import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Escapes the LIKE wildcards `%` and `_` (and the escape char `\`) so a user's
 * search term is matched literally rather than as a pattern. Pair with an
 * `ESCAPE '\'` clause (see {@link likeContains}).
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Case-insensitive "column contains query" predicate. The query is escaped so
 * literal `%`/`_` in user input don't act as wildcards. SQLite LIKE is
 * case-insensitive for ASCII by default.
 */
export function likeContains(column: AnyColumn, query: string): SQL {
  return sql`${column} LIKE ${'%' + escapeLike(query) + '%'} ESCAPE '\\'`;
}
