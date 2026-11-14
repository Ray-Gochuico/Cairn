import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Same module mocks as tests/pages/setup/forms/HoldingForm.test.tsx.
vi.mock('@/market/fetch-on-add', () => ({ fetchMarketDataOnAdd: vi.fn() }));
vi.mock('@/db/db', () => ({ getDatabase: vi.fn(() => ({})) }));

import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { AccountType } from '@/types/enums';
import type { Account } from '@/types/schema';
import HoldingForm from '@/pages/setup/forms/HoldingForm';

function makeAccount(id: number, name: string): Account {
  return {
    id,
    householdId: 1,
    name,
    type: AccountType.ACCOUNT_BROKERAGE,
    institution: null,
    contributionLimitAnnual: null,
    employerMatchPct: null,
    apyRate: null,
    accountNumberLast4: null,
    notes: null,
    cryptoWalletAddress: null,
    isRetirementAccount: false,
    monthlyDistribution: null,
    distributionStartDate: null,
    cashApr: null,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    accentColor: null,
    sortOrder: null,
  };
}

const create = vi.fn();

async function typeRow(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('ticker'), 'VTI');
  const shares = screen.getByLabelText('shares');
  await user.clear(shares);
  await user.type(shares, '25');
  await user.type(screen.getByLabelText('target allocation (%)'), '60');
  await user.type(screen.getByLabelText('cost basis'), '5000');
}

function expectTypedRow() {
  expect(screen.getByLabelText('ticker')).toHaveValue('VTI');
  expect(screen.getByLabelText('shares')).toHaveValue(25);
  expect(screen.getByLabelText('target allocation (%)')).toHaveValue(60);
  expect(screen.getByLabelText('cost basis')).toHaveValue(5000);
}

describe('v1.8.0 O1 (RC1): the setup "Add a holding" account pick keeps the typed row', () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue(1);
    useAccountsStore.setState({
      accounts: [makeAccount(11, 'Brokerage A'), makeAccount(22, 'Roth B')],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
    useHoldingsStore.setState({
      holdings: [],
      isLoading: false,
      error: null,
      load: async () => {},
      create,
      update: async () => {},
      remove: async () => {},
    } as any);
  });

  it('a new account keeps the ticker, shares, target and cost basis, and Add holding saves them to that account', async () => {
    const user = userEvent.setup();
    render(<HoldingForm />);
    const picker = screen.getByLabelText(/^account$/i) as HTMLSelectElement;
    expect(picker.value).toBe('11');
    await typeRow(user);
    const ticker = screen.getByLabelText('ticker');

    await user.selectOptions(picker, '22');

    expect(picker.value).toBe('22');
    expectTypedRow();
    expect(ticker.isConnected).toBe(true); // the same row, never a fresh one
    await user.click(screen.getByRole('button', { name: /add holding/i }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toEqual({
      accountId: 22,
      ticker: 'VTI',
      shareCount: 25,
      targetAllocationPct: 0.6,
      costBasis: 5000,
    });
  });

  it('typing after a pick and then picking the first account again keeps the row, and Add holding saves to the first account', async () => {
    const user = userEvent.setup();
    render(<HoldingForm />);
    const picker = screen.getByLabelText(/^account$/i) as HTMLSelectElement;
    await user.selectOptions(picker, '22');
    await typeRow(user);

    await user.selectOptions(picker, '11');

    expect(picker.value).toBe('11');
    expectTypedRow();
    await user.click(screen.getByRole('button', { name: /add holding/i }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ accountId: 11, ticker: 'VTI', shareCount: 25 });
  });
});
