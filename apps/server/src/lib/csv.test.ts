import { describe, it, expect } from 'vitest';
import { parseCsv, toCsv } from './csv.js';

describe('toCsv', () => {
  it('writes header + rows with CRLF separators', () => {
    const csv = toCsv(
      [
        { a: 1, b: 'hi' },
        { a: 2, b: 'world' },
      ],
      [
        { key: 'a', header: 'A' },
        { key: 'b', header: 'B' },
      ],
    );
    expect(csv).toBe('A,B\r\n1,hi\r\n2,world\r\n');
  });

  it('quotes fields containing commas, quotes and newlines', () => {
    const csv = toCsv(
      [{ x: 'with, comma' }, { x: 'with "quotes"' }, { x: 'with\nnewline' }],
      [{ key: 'x', header: 'X' }],
    );
    expect(csv).toBe('X\r\n"with, comma"\r\n"with ""quotes"""\r\n"with\nnewline"\r\n');
  });

  it('serializes dates, booleans, objects and null', () => {
    const csv = toCsv(
      [{ d: new Date('2026-01-02T03:04:05Z'), b: true, o: { x: 1 }, n: null }],
      [
        { key: 'd', header: 'date' },
        { key: 'b', header: 'bool' },
        { key: 'o', header: 'obj' },
        { key: 'n', header: 'nul' },
      ],
    );
    expect(csv).toBe('date,bool,obj,nul\r\n2026-01-02T03:04:05.000Z,1,"{""x"":1}",\r\n');
  });
});

describe('parseCsv', () => {
  it('parses simple CSV with headers', () => {
    const { headers, rows } = parseCsv('code,name\r\nLAP-1,One\r\nLAP-2,Two\r\n');
    expect(headers).toEqual(['code', 'name']);
    expect(rows).toEqual([
      { code: 'LAP-1', name: 'One' },
      { code: 'LAP-2', name: 'Two' },
    ]);
  });

  it('handles quoted fields with commas, quotes, and newlines', () => {
    const csv = 'a,b\r\n"with, comma","with ""quotes"""\r\n"multi\nline","plain"\r\n';
    const { rows } = parseCsv(csv);
    expect(rows).toEqual([
      { a: 'with, comma', b: 'with "quotes"' },
      { a: 'multi\nline', b: 'plain' },
    ]);
  });

  it('tolerates LF-only line endings and trims a UTF-8 BOM', () => {
    const csv = '﻿a,b\nx,y\n';
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([{ a: 'x', b: 'y' }]);
  });

  it('returns empty arrays for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });

  it('drops trailing empty lines', () => {
    const { rows } = parseCsv('a\r\nx\r\n\r\n');
    expect(rows).toEqual([{ a: 'x' }]);
  });
});
