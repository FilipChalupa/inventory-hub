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
