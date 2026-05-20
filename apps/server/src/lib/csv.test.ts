import { describe, it, expect } from 'vitest';
import { toCsv } from './csv.js';

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
    expect(csv).toBe(
      'X\r\n"with, comma"\r\n"with ""quotes"""\r\n"with\nnewline"\r\n',
    );
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
