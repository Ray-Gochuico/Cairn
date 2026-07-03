import { describe, it, expect, vi } from 'vitest';
import { toCsv, downloadCsv, type CsvColumn } from '@/lib/csv';
import { parseCsv } from '@/lib/import/parse-csv';

interface Row {
  name: string;
  amount: number;
  active: boolean;
  note: string | null;
}

const columns: CsvColumn<Row>[] = [
  { header: 'name', value: (r) => r.name },
  { header: 'amount', value: (r) => r.amount },
  { header: 'active', value: (r) => r.active },
  { header: 'note', value: (r) => r.note },
];

describe('toCsv', () => {
  it('emits a header row then one line per row', () => {
    const csv = toCsv([{ name: 'A', amount: 1, active: true, note: null }], columns);
    expect(csv.split('\n')).toEqual(['name,amount,active,note', 'A,1,true,']);
  });

  it('returns just the header row for an empty row list', () => {
    expect(toCsv([], columns)).toBe('name,amount,active,note');
  });

  it('coerces numbers and booleans, and renders null as an empty cell', () => {
    const csv = toCsv([{ name: 'B', amount: 12.5, active: false, note: null }], columns);
    expect(csv.split('\n')[1]).toBe('B,12.5,false,');
  });

  it('quotes a field containing a comma and doubles embedded quotes', () => {
    const csv = toCsv(
      [{ name: 'ACME, INC', amount: 0, active: false, note: 'a "quoted" word' }],
      columns,
    );
    expect(csv.split('\n')[1]).toBe('"ACME, INC",0,false,"a ""quoted"" word"');
  });

  it('quotes a field containing a newline', () => {
    const csv = toCsv([{ name: 'L1\nL2', amount: 0, active: false, note: null }], columns);
    expect(csv).toBe('name,amount,active,note\n"L1\nL2",0,false,');
  });

  it('quotes a header that itself contains a comma', () => {
    const csv = toCsv<Row>([], [{ header: 'a,b', value: (r) => r.name }]);
    expect(csv).toBe('"a,b"');
  });
});

describe('toCsv — formula-injection guard', () => {
  const cols: CsvColumn<{ v: string | number }>[] = [{ header: 'v', value: (r) => r.v }];
  const cell = (v: string | number) => toCsv([{ v }], cols).split('\n')[1];

  it('neutralizes leading = @ + TAB CR with a quote prefix', () => {
    expect(cell('=cmd|/C calc')).toBe("'=cmd|/C calc");
    expect(cell('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)");
    expect(cell('+1+1')).toBe("'+1+1");
    expect(cell('\t=1+1')).toBe("'\t=1+1");
    expect(cell('\r=1+1')).toBe("'\r=1+1");
  });

  it('guards minus-led TEXT (not a number)', () => {
    expect(cell('-not a number')).toBe("'-not a number");
  });

  it('leaves plain numbers alone — including negatives and exponent forms', () => {
    expect(cell(-123.45)).toBe('-123.45');
    expect(cell('-123.45')).toBe('-123.45');
    expect(cell('-1.5e3')).toBe('-1.5e3');
    expect(cell(0.06)).toBe('0.06');
  });

  it('leaves ordinary text and mid-string specials alone', () => {
    expect(cell('a=b')).toBe('a=b');
    expect(cell('ACME + CO')).toBe('ACME + CO');
  });

  it('still applies RFC-4180 quoting AFTER the guard', () => {
    expect(cell('=HYPERLINK("http://evil","x"),1')).toBe(
      '"\'=HYPERLINK(""http://evil"",""x""),1"',
    );
  });

  it('round-trips through the import parser with the guard visible and data intact', () => {
    const rows = [{ v: '=cmd' }, { v: '-123.45' }, { v: 'plain, text' }];
    const csv = toCsv(rows, cols);
    const parsed = parseCsv(csv);
    expect(parsed.errors).toEqual([]);
    // Guarded text carries the apostrophe (the standard, accepted mitigation
    // cost); numbers and ordinary text round-trip byte-identically.
    expect(parsed.rows.map((r) => r.v)).toEqual(["'=cmd", '-123.45', 'plain, text']);
  });
});

describe('downloadCsv', () => {
  it('creates a text/csv blob and triggers an anchor download', () => {
    let captured: Blob | undefined;
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((b) => {
        captured = b as Blob;
        return 'blob:mock';
      });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    downloadCsv('test.csv', 'a,b\n1,2');

    expect(captured?.type).toBe('text/csv;charset=utf-8');
    expect(createSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();

    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });
});
