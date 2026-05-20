import type { LocationRow } from './api.js';

const MAX_DEPTH = 20;

/**
 * Returns the breadcrumb path for a location, e.g. "Budova A › 1.NP › Kancelář".
 * Stops at MAX_DEPTH to defend against accidental cycles in the data.
 */
export function locationPath(locations: LocationRow[], id: string | null): string {
  if (!id) return '';
  const byId = new Map(locations.map((l) => [l.id, l] as const));
  const parts: string[] = [];
  let current = byId.get(id);
  let depth = 0;
  while (current && depth < MAX_DEPTH) {
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  return parts.join(' › ');
}

/**
 * Returns locations in DFS order with their tree depth, sorted alphabetically
 * inside each level. Useful for rendering indented dropdowns / tree views.
 */
export function locationsAsTree(
  locations: LocationRow[],
): Array<{ row: LocationRow; depth: number }> {
  const byParent = new Map<string | null, LocationRow[]>();
  for (const l of locations) {
    const arr = byParent.get(l.parentId) ?? [];
    arr.push(l);
    byParent.set(l.parentId, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  }
  const out: Array<{ row: LocationRow; depth: number }> = [];
  function walk(parentId: string | null, depth: number) {
    if (depth >= MAX_DEPTH) return;
    const children = byParent.get(parentId) ?? [];
    for (const c of children) {
      out.push({ row: c, depth });
      walk(c.id, depth + 1);
    }
  }
  walk(null, 0);
  // Append any orphan rows that didn't surface via the root walk (e.g. parent
  // missing or cycle), so they don't silently disappear from the UI.
  const seen = new Set(out.map((x) => x.row.id));
  for (const l of locations) {
    if (!seen.has(l.id)) out.push({ row: l, depth: 0 });
  }
  return out;
}
