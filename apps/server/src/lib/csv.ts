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

/**
 * Minimal RFC 4180 CSV reader. Returns rows as objects keyed by header.
 * Handles quoted fields, embedded commas, escaped quotes (""), and
 * CRLF/LF line endings. Skips trailing empty lines.
 */
export function parseCsv(input: string): { headers: string[]; rows: Record<string, string>[] } {
  // Strip UTF-8 BOM if present.
  const src = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // ignore — handled with \n
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  // flush last field
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop trailing empty rows
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c === '')) rows.pop();

  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0]!.map((h) => h.trim());
  const data = rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows: data };
}
