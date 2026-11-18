/**
 * v1.8.0 W4 (PG-4, task_90fd839b PRIORITY; C041): the batch queue moves past
 * a file only while that file is the one on screen.
 *
 * Both a dismissal and a save called the same `prev.slice(1)`, so a late
 * call for a file already left behind (a commit that lands after its file
 * was skipped, or a stray close after its save) moved the queue a second
 * time and dropped the next file unreviewed. The preview is replaced here by
 * a stand-in that records the callbacks it was given, so each file's own
 * callbacks can be called out of order — the shape the in-flight race had.
 * Clock-free.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type PreviewProps = {
  parsed: { rows: ReadonlyArray<Record<string, string>> };
  queuePosition?: { current: number; total: number };
  onOpenChange: (open: boolean) => void;
  onSaved?: (n: number) => void;
};
const h = vi.hoisted(() => ({ props: [] as PreviewProps[] }));

vi.mock('@/components/import/ImportPreviewModal', () => ({
  ImportPreviewModal: (p: PreviewProps) => {
    h.props.push(p);
    const pos = p.queuePosition ? `File ${p.queuePosition.current} of ${p.queuePosition.total}` : 'One file';
    return <div data-testid="preview">{`${pos}: ${p.parsed.rows[0]?.total_value ?? ''}`}</div>;
  },
}));
vi.mock('@/lib/csv', () => ({ downloadCsv: vi.fn() }));

import { act, fireEvent, render, screen } from '@testing-library/react';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';

const csv = (v: string) => `account,snapshot_date,total_value\nFidelity 401k,2026-10-31,${v}\n`;

async function queueTwo(): Promise<PreviewProps> {
  render(<ImportCsvButton entity="snapshot" />);
  const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
  fireEvent.change(input, {
    target: {
      files: [
        new File([csv('1000')], 'october.csv', { type: 'text/csv' }),
        new File([csv('2000')], 'november.csv', { type: 'text/csv' }),
      ],
    },
  });
  expect(await screen.findByTestId('preview')).toHaveTextContent('File 1 of 2: 1000');
  return h.props.at(-1)!;
}

describe('ImportCsvButton: the queue moves past a file only while it is on screen (PG-4, C041)', () => {
  beforeEach(() => {
    h.props.length = 0;
    useAccountsStore.setState({ accounts: [{ id: 1, name: 'Fidelity 401k' } as never] });
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  });

  it('file 1 skipped, then its commit lands: file 2 stays on screen', async () => {
    const first = await queueTwo();
    act(() => first.onOpenChange(false));
    expect(screen.getByTestId('preview')).toHaveTextContent('File 2 of 2: 2000');
    act(() => first.onSaved!(1));
    expect(screen.getByTestId('preview')).toHaveTextContent('File 2 of 2: 2000');
  });

  it('file 1 saved, then a stray close for file 1: file 2 stays on screen', async () => {
    const first = await queueTwo();
    act(() => first.onSaved!(1));
    expect(screen.getByTestId('preview')).toHaveTextContent('File 2 of 2: 2000');
    act(() => first.onOpenChange(false));
    expect(screen.getByTestId('preview')).toHaveTextContent('File 2 of 2: 2000');
  });

  it("file 2's own save still closes the batch", async () => {
    const first = await queueTwo();
    act(() => first.onSaved!(1));
    const second = h.props.at(-1)!;
    act(() => second.onSaved!(1));
    expect(screen.queryByTestId('preview')).toBeNull();
  });
});
