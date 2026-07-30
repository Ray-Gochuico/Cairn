import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }));

import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
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

  it('neutralizes LF, VT, and FF leads too (round-3 cleanup)', () => {
    // Spreadsheet engines strip these whitespace leads before formula
    // detection, same as TAB/CR. \v and \f pass through unquoted; a \n
    // cell gets CSV-quoted, so assert on the full output there.
    expect(cell('\v=SUM(A1)')).toBe("'\v=SUM(A1)");
    expect(cell('\f=SUM(A1)')).toBe("'\f=SUM(A1)");
    expect(toCsv([{ v: '\n=SUM(A1)' }], cols)).toContain("'\n=SUM(A1)");
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

describe('downloadCsv — browser runtime', () => {
  it('creates a text/csv blob and triggers an anchor download', async () => {
    let captured: Blob | undefined;
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((b) => {
        captured = b as Blob;
        return 'blob:mock';
      });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await downloadCsv('test.csv', 'a,b\n1,2');

    expect(captured?.type).toBe('text/csv;charset=utf-8');
    expect(createSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
    // The native-save path must not run outside Tauri.
    expect(vi.mocked(save)).not.toHaveBeenCalled();
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();

    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });
});

describe('downloadCsv — Tauri runtime (native save dialog + fs write)', () => {
  beforeEach(() => {
    // isTauriRuntime() probes exactly this marker (src/lib/tauri-runtime.ts).
    (window as any).__TAURI_INTERNALS__ = {};
    vi.mocked(save).mockReset();
    vi.mocked(writeFile).mockReset();
  });
  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('saves via the native dialog and plugin-fs writeFile, never the anchor path', async () => {
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => 'blob:mock');
    vi.mocked(save).mockResolvedValue('/Users/you/Documents/test.csv');
    vi.mocked(writeFile).mockResolvedValue(undefined as never);

    await downloadCsv('test.csv', 'a,b\n1,2');

    expect(vi.mocked(save)).toHaveBeenCalledWith({
      defaultPath: 'test.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    expect(vi.mocked(writeFile)).toHaveBeenCalledTimes(1);
    const [dest, bytes] = vi.mocked(writeFile).mock.calls[0];
    expect(dest).toBe('/Users/you/Documents/test.csv');
    // Bytes must decode back to the exact CSV text (UTF-8).
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe('a,b\n1,2');
    // The browser download-manager path must NOT run in Tauri — WKWebView
    // has no download manager, so it would be a silent no-op.
    expect(createSpy).not.toHaveBeenCalled();

    createSpy.mockRestore();
  });

  it('treats a cancelled save dialog as a clean no-op', async () => {
    vi.mocked(save).mockResolvedValue(null);

    await expect(downloadCsv('test.csv', 'a,b')).resolves.toBeUndefined();

    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });
});
