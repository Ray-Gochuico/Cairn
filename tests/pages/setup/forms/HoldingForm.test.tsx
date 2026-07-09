import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('Wizard HoldingForm (adapter)', () => {
  beforeEach(() => {
    useHoldingsStore.setState({
      holdings: [],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
  });

  it('renders an empty-state when no accounts exist', () => {
    useAccountsStore.setState({
      accounts: [],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
    render(<HoldingForm />);
    expect(
      screen.getByText(/add an account first/i),
    ).toBeInTheDocument();
  });

  it('renders an account picker and the underlying holding fields when accounts exist', () => {
    useAccountsStore.setState({
      accounts: [makeAccount(1, 'Brokerage')],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
    render(<HoldingForm />);
    const picker = screen.getByLabelText(/^account$/i) as HTMLSelectElement;
    expect(picker).toBeInTheDocument();
    expect(picker.value).toBe('1');
    expect(
      screen.getByRole('button', { name: /add holding/i }),
    ).toBeInTheDocument();
  });

  it('right-aligns numeric holding inputs with tabular numerals (Wave 11 T7)', () => {
    useAccountsStore.setState({
      accounts: [makeAccount(1, 'Brokerage')],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
    render(<HoldingForm />);
    expect(screen.getByLabelText('shares')).toHaveClass('tabular-nums');
    expect(screen.getByLabelText('cost basis')).toHaveClass('tabular-nums');
  });
});
