import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountBalanceHistory from '@/components/investments/manage/AccountBalanceHistory';
import { useSnapshotsStore } from '@/stores/snapshots-store';

const SNAPS = [
  { id: 11, accountId: 1, snapshotDate: '2026-06-30', totalValue: 118000, source: 'AUTO_DERIVED' },
  { id: 12, accountId: 1, snapshotDate: '2026-07-31', totalValue: 121000, source: 'MANUAL' },
  { id: 13, accountId: 2, snapshotDate: '2026-07-31', totalValue: 9000, source: 'MANUAL' }, // other account
];

beforeEach(() => {
  useSnapshotsStore.setState({
    snapshots: SNAPS, isLoading: false, error: null,
    load: async () => {}, remove: vi.fn(async () => {}),
  } as never);
});

describe('AccountBalanceHistory (Wave C C7/IN-G5)', () => {
  it('lists only this account, newest first, with value + source', async () => {
    const user = userEvent.setup();
    render(<AccountBalanceHistory accountId={1} accountName="Brokerage" />);
    await user.click(screen.getByText('Balance history (2)'));
    const rows = screen.getAllByTestId(/balance-history-row-1-/);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('2026-07-31');
    expect(rows[0]).toHaveTextContent('$121,000');
    expect(rows[0]).toHaveTextContent('manual');
  });

  it('delete confirms, then wires the caller-less useSnapshotsStore.remove', async () => {
    const user = userEvent.setup();
    render(<AccountBalanceHistory accountId={1} accountName="Brokerage" />);
    await user.click(screen.getByText('Balance history (2)'));
    await user.click(screen.getByRole('button', { name: 'Delete Brokerage snapshot 2026-07-31' }));
    expect(await screen.findByText('Delete this balance snapshot?')).toBeInTheDocument();
    // The useConfirm dialog's confirm button label is exactly "Delete"
    // (row buttons carry longer aria-labels, so this match is unique).
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useSnapshotsStore.getState().remove).toHaveBeenCalledWith(12);
  });
});
