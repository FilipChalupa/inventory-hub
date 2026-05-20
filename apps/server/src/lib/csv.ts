/**
 * Minimal CSV (RFC 4180) writer.
 * - quotes fields that contain ", , \r or \n
 * - doubles internal quotes
 * - serializes dates as ISO 8601
 * - serializes null/undefined as empty
 */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
): string {
  const header = columns.map((c) => csvField(c.header)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => csvField(serializeValue(row[c.key]))).join(','),
  );
  return [header, ...lines].join('\r\n') + '\r\n';
}

function serializeValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function csvField(s: string): string {
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
