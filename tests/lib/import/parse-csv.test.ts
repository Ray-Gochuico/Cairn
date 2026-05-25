import { describe, it, expect } from 'vitest';
import { parseCsv } from '@/lib/import/parse-csv';

describe('parseCsv', () => {
  it('parses a simple two-column file', () => {
    const text = 'name,age\nAlice,30\nBob,25\n';
    const r = parseCsv(text);
    expect(r.headers).toEqual(['name', 'age']);
    expect(r.rows).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' },
    ]);
    expect(r.errors).toEqual([]);
  });

  it('returns empty rows when only headers are present', () => {
    const r = parseCsv('a,b,c\n');
    expect(r.headers).toEqual(['a', 'b', 'c']);
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it('returns empty rows and empty headers for empty input', () => {
    const r = parseCsv('');
    expect(r.headers).toEqual([]);
    expect(r.rows).toEqual([]);
  });

  it('unquotes fields that were quoted', () => {
    const r = parseCsv('a,b\n"hello","world"\n');
    expect(r.rows[0]).toEqual({ a: 'hello', b: 'world' });
  });

  it('preserves commas inside quoted fields', () => {
    const r = parseCsv('a,b\n"hello, world","again, here"\n');
    expect(r.rows[0]).toEqual({ a: 'hello, world', b: 'again, here' });
  });

  it('un-escapes double-quoted quote characters', () => {
    const r = parseCsv('a,b\n"she said ""hi""","ok"\n');
    expect(r.rows[0]).toEqual({ a: 'she said "hi"', b: 'ok' });
  });

  it('preserves newlines inside quoted fields', () => {
    const r = parseCsv('a,b\n"line1\nline2","x"\n');
    expect(r.rows[0]).toEqual({ a: 'line1\nline2', b: 'x' });
  });

  it('accepts CRLF line endings', () => {
    const r = parseCsv('a,b\r\nx,y\r\n');
    expect(r.rows).toEqual([{ a: 'x', b: 'y' }]);
  });

  it('accepts mixed CRLF and LF line endings', () => {
    const r = parseCsv('a,b\r\nx,y\nz,w\r\n');
    expect(r.rows).toEqual([{ a: 'x', b: 'y' }, { a: 'z', b: 'w' }]);
  });

  it('strips a UTF-8 BOM from the start of the file', () => {
    const r = parseCsv('﻿name,age\nAlice,30\n');
    expect(r.headers).toEqual(['name', 'age']);
    expect(r.rows[0]).toEqual({ name: 'Alice', age: '30' });
  });

  it('skips empty trailing rows', () => {
    const r = parseCsv('a,b\n1,2\n\n\n');
    expect(r.rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('reports an error when a row has the wrong column count', () => {
    const r = parseCsv('a,b,c\n1,2\n4,5,6\n');
    expect(r.rows).toEqual([{ a: '4', b: '5', c: '6' }]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ line: 2 });
    expect(r.errors[0].message).toContain('expected 3');
  });

  it('reports an error for an unterminated quoted field', () => {
    const r = parseCsv('a,b\n"unterminated\n');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toContain('unterminated');
  });
});
