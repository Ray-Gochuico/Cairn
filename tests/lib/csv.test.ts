import { describe, it, expect, vi } from 'vitest';
import { toCsv, downloadCsv, type CsvColumn } from '@/lib/csv';

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
