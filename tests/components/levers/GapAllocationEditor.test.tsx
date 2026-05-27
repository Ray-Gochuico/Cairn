import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GapAllocationEditor } from '@/components/whatif/levers/GapAllocationEditor';
import type { GapAllocation } from '@/lib/scenarios';
import type { Account } from '@/types/schema';
import { AccountType } from '@/types/enums';

const k401: Account = {
  id: 10, householdId: 1, name: '401k', type: AccountType.ACCOUNT_401K, excludedFromNetWorth: false,
} as unknown as Account;
const rothIra: Account = {
  id: 11, householdId: 1, name: 'Roth IRA', type: AccountType.ACCOUNT_ROTH_IRA, excludedFromNetWorth: false,
} as unknown as Account;
const brokerage: Account = {
  id: 20, householdId: 1, name: 'Vanguard', type: AccountType.ACCOUNT_BROKERAGE, excludedFromNetWorth: false,
} as unknown as Account;

const accountsByBucketFixture = {
  taxAdvantaged: [k401, rothIra],
  brokerage: [brokerage],
  cash: [] as Account[],
};

describe('GapAllocationEditor', () => {
  it('renders Tax-advantaged, Brokerage, and Cash (read-only) rows', () => {
    render(<GapAllocationEditor
      gap={6250}
      gapAllocation={{ taxAdvantaged: null, brokerage: null }}
      accountsByBucket={accountsByBucketFixture}
      onChange={vi.fn()}
    />);
    expect(screen.getByText(/^Tax-advantaged$/)).toBeInTheDocument();
    expect(screen.getByText(/^Brokerage$/)).toBeInTheDocument();
    expect(screen.getByText(/^Cash \(remainder\)$/)).toBeInTheDocument();
  });

  it('with all-cash default shows $6,250 cash remainder', () => {
    render(<GapAllocationEditor
      gap={6250}
      gapAllocation={{ taxAdvantaged: null, brokerage: null }}
      accountsByBucket={accountsByBucketFixture}
      onChange={vi.fn()}
    />);
    expect(screen.getByTestId('gap-alloc-cash-remainder')).toHaveTextContent('$6,250');
  });

  it('with no surplus (gap <= 0) shows the "no surplus" message instead of the editor', () => {
    render(<GapAllocationEditor
      gap={0}
      gapAllocation={{ taxAdvantaged: null, brokerage: null }}
      accountsByBucket={accountsByBucketFixture}
      onChange={vi.fn()}
    />);
    expect(screen.getByText(/no surplus to allocate/i)).toBeInTheDocument();
    expect(screen.queryByTestId('gap-allocation-editor')).toBeNull();
  });

  it('typing in the Tax-advantaged percent input calls onChange with the percent value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<GapAllocationEditor
      gap={6250}
      gapAllocation={{ taxAdvantaged: null, brokerage: null }}
      accountsByBucket={accountsByBucketFixture}
      onChange={onChange}
    />);
    const input = screen.getByLabelText(/Tax-advantaged percent amount/i);
    await user.type(input, '5');
    // The default null bucket gets initialized to {mode:'percent', value:0.05, accountSplits:null}
    // on the first keystroke.
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      taxAdvantaged: expect.objectContaining({ mode: 'percent' }),
    }));
  });

  it('switching mode % → $ on Tax-advantaged converts the value (50% × $6250 = $3125)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<GapAllocationEditor
      gap={6250}
      gapAllocation={{ taxAdvantaged: { mode: 'percent', value: 0.5, accountSplits: null }, brokerage: null }}
      accountsByBucket={accountsByBucketFixture}
      onChange={onChange}
    />);
    await user.selectOptions(screen.getByLabelText(/Tax-advantaged mode/i), 'fixed');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      taxAdvantaged: { mode: 'fixed', value: 3125, accountSplits: null },
    }));
  });

  it('switching mode $ → % does NOT auto-convert (user enters % manually)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<GapAllocationEditor
      gap={6250}
      gapAllocation={{ taxAdvantaged: { mode: 'fixed', value: 1000, accountSplits: null }, brokerage: null }}
      accountsByBucket={accountsByBucketFixture}
      onChange={onChange}
    />);
    await user.selectOptions(screen.getByLabelText(/Tax-advantaged mode/i), 'percent');
    // Value stays at 1000 — the user is expected to re-enter the percent.
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      taxAdvantaged: { mode: 'percent', value: 1000, accountSplits: null },
    }));
  });

  it('shows per-account split rows under a non-cash bucket when it has accounts', () => {
    render(<GapAllocationEditor
      gap={6250}
      gapAllocation={{ taxAdvantaged: { mode: 'percent', value: 0.5, accountSplits: null }, brokerage: null }}
      accountsByBucket={accountsByBucketFixture}
      onChange={vi.fn()}
    />);
    expect(screen.getByText('401k')).toBeInTheDocument();
    expect(screen.getByText('Roth IRA')).toBeInTheDocument();
    // Even split default: 50% each (1/2 × 100 = 50).
    const k401Input = screen.getByLabelText(/401k percent/i) as HTMLInputElement;
    expect(k401Input.value).toBe('50');
  });

  it('editing a per-account split percent calls onChange with the new accountSplits', async () => {
    const user = userEvent.setup();
    // Wire the editor up to its own React state so the per-keystroke onChange
    // calls propagate back as prop updates — otherwise each character event
    // sees the same `accountSplits: null` from the original prop and produces
    // a different sequence.
    function Wrapper() {
      const [alloc, setAlloc] = useState<GapAllocation>({
        taxAdvantaged: { mode: 'percent', value: 0.5, accountSplits: null },
        brokerage: null,
      });
      return (
        <>
          <GapAllocationEditor
            gap={6250}
            gapAllocation={alloc}
            accountsByBucket={accountsByBucketFixture}
            onChange={setAlloc}
          />
          <span data-testid="alloc-json">{JSON.stringify(alloc)}</span>
        </>
      );
    }
    render(<Wrapper />);
    const input = screen.getByLabelText(/401k percent/i);
    await user.clear(input);
    await user.type(input, '60');
    // After typing "60", the visible 401k input must read 60. The Roth row
    // should rebalance to 40% (the remaining 1 - 0.6 = 0.4 redistributed).
    const json = screen.getByTestId('alloc-json').textContent ?? '{}';
    const alloc = JSON.parse(json) as GapAllocation;
    expect(alloc.taxAdvantaged?.accountSplits).toEqual([
      { accountId: 10, pct: 0.6 },
      { accountId: 11, pct: 0.4 },
    ]);
  });

  it('shows empty-bucket warning when a bucket has a non-zero allocation but no accounts', () => {
    render(<GapAllocationEditor
      gap={6250}
      gapAllocation={{ taxAdvantaged: { mode: 'percent', value: 0.5, accountSplits: null }, brokerage: null }}
      accountsByBucket={{ taxAdvantaged: [], brokerage: [], cash: [] }}
      onChange={vi.fn()}
    />);
    expect(screen.getByRole('alert')).toHaveTextContent(/no tax-advantaged accounts/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/redirected to cash/i);
  });

  it('Reset to defaults clears both buckets to null', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<GapAllocationEditor
      gap={6250}
      gapAllocation={{
        taxAdvantaged: { mode: 'percent', value: 0.5, accountSplits: null },
        brokerage:     { mode: 'fixed', value: 1000, accountSplits: null },
      }}
      accountsByBucket={accountsByBucketFixture}
      onChange={onChange}
    />);
    await user.click(screen.getByRole('button', { name: /reset to defaults/i }));
    expect(onChange).toHaveBeenLastCalledWith({ taxAdvantaged: null, brokerage: null });
  });

  it('cash row updates live as the user changes bucket percentages', async () => {
    const user = userEvent.setup();
    function Wrapper() {
      const [alloc, setAlloc] = useState<GapAllocation>({ taxAdvantaged: null, brokerage: null });
      return (
        <GapAllocationEditor
          gap={6250}
          gapAllocation={alloc}
          accountsByBucket={accountsByBucketFixture}
          onChange={setAlloc}
        />
      );
    }
    render(<Wrapper />);
    // Initial: all $6250 to cash.
    expect(screen.getByTestId('gap-alloc-cash-remainder')).toHaveTextContent('$6,250');
    // Set tax-advantaged to 60%. Cash should drop to 40% of $6250 = $2,500.
    const input = screen.getByLabelText(/Tax-advantaged percent amount/i);
    await user.clear(input);
    await user.type(input, '60');
    expect(screen.getByTestId('gap-alloc-cash-remainder')).toHaveTextContent('$2,500');
  });
});
