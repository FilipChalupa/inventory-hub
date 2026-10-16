/**
 * Extracts the asset code from either a full URL (e.g. https://host/a/LAP-00001)
 * or a bare code, normalising to uppercase. Returns null for inputs that
 * don't look like a code.
 */
export function parseScannedValue(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/a\/([A-Za-z0-9-]+)/);
  if (urlMatch) return urlMatch[1]!.toUpperCase();
  if (/^[A-Z0-9-]{3,}$/i.test(trimmed)) return trimmed.toUpperCase();
  return null;
}

/**
 * What a scanned/typed value points at: our own QR (a URL to /a/<code>) is
 * resolved locally; anything else — a bare code, a manufacturer serial or EAN
 * barcode — goes through the server's exact identifier lookup.
 */
export type ScanTarget = { kind: 'code'; code: string } | { kind: 'lookup'; value: string };

export function classifyScan(raw: string): ScanTarget | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/a\/([A-Za-z0-9-]+)/);
  if (urlMatch) return { kind: 'code', code: urlMatch[1]!.toUpperCase() };
  return { kind: 'lookup', value: trimmed };
}
