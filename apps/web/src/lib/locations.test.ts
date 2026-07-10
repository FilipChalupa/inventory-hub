import { describe, it, expect } from 'vitest';
import { locationPath, locationsAsTree } from './locations.js';
import type { LocationRow } from './api.js';

function loc(id: string, name: string, parentId: string | null = null): LocationRow {
  return { id, name, parentId };
}

describe('locationPath', () => {
  const rows: LocationRow[] = [
    loc('a', 'Budova A'),
    loc('b', '1.NP', 'a'),
    loc('c', 'Kancelář', 'b'),
  ];

  it('returns the breadcrumb path joined with ›', () => {
    expect(locationPath(rows, 'c')).toBe('Budova A › 1.NP › Kancelář');
  });

  it('returns an empty string for null id', () => {
    expect(locationPath(rows, null)).toBe('');
  });

  it('skips silently when a parent id is missing', () => {
    const orphans: LocationRow[] = [loc('x', 'Sirotek', 'ghost')];
    expect(locationPath(orphans, 'x')).toBe('Sirotek');
  });

  it('terminates on cycles instead of looping forever', () => {
    const cycle: LocationRow[] = [loc('a', 'A', 'b'), loc('b', 'B', 'a')];
    const path = locationPath(cycle, 'a');
    expect(path.length).toBeGreaterThan(0);
    expect(path.split(' › ').length).toBeLessThanOrEqual(20);
  });
});

describe('locationsAsTree', () => {
  it('returns DFS-ordered nodes with depth', () => {
    const rows: LocationRow[] = [
      loc('b', '1.NP', 'a'),
      loc('a', 'Budova A'),
      loc('c', 'Kancelář', 'b'),
    ];
    expect(locationsAsTree(rows)).toEqual([
      { row: { id: 'a', name: 'Budova A', parentId: null }, depth: 0 },
      { row: { id: 'b', name: '1.NP', parentId: 'a' }, depth: 1 },
      { row: { id: 'c', name: 'Kancelář', parentId: 'b' }, depth: 2 },
    ]);
  });

  it('sorts siblings alphabetically (Czech locale)', () => {
    const rows: LocationRow[] = [loc('z', 'Žižkov'), loc('a', 'Adamov'), loc('c', 'Černý Most')];
    expect(locationsAsTree(rows).map((x) => x.row.name)).toEqual([
      'Adamov',
      'Černý Most',
      'Žižkov',
    ]);
  });

  it('surfaces orphans with a missing parent at the end', () => {
    const rows: LocationRow[] = [
      loc('root', 'Budova'),
      loc('orphan', 'Ztracená', 'missing-parent'),
    ];
    const out = locationsAsTree(rows);
    expect(out.map((x) => x.row.id)).toContain('orphan');
    expect(out.find((x) => x.row.id === 'root')!.depth).toBe(0);
  });

  it('does not silently drop nodes caught in a cycle', () => {
    const rows: LocationRow[] = [loc('a', 'A', 'b'), loc('b', 'B', 'a')];
    const out = locationsAsTree(rows);
    const ids = out.map((x) => x.row.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('returns an empty array for no input', () => {
    expect(locationsAsTree([])).toEqual([]);
  });

  it('handles multiple roots independently', () => {
    const rows: LocationRow[] = [loc('r1', 'Alpha'), loc('r2', 'Beta'), loc('c1', 'Gamma', 'r1')];
    const out = locationsAsTree(rows);
    expect(out.map((x) => `${x.depth}:${x.row.name}`)).toEqual(['0:Alpha', '1:Gamma', '0:Beta']);
  });
});
