import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InvestmentTimeSeriesChart from '@/components/charts/InvestmentTimeSeriesChart';
import { AccountType, SnapshotSource } from '@/types/enums';
import { getGranularity, getSelectedAccounts, getTimeWindow } from '@/lib/investment-chart-prefs';
import type { Account, Holding, AccountSnapshot } from '@/types/schema';

const accounts: Account[] = [
  {
    id: 1,
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name: 'Brokerage',
    institution: null,
    type: AccountType.ACCOUNT_BROKERAGE,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    allowMargin: false,
    stateOfPlan: null,
  },
  {
    id: 2,
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name: 'Roth IRA',
    institution: null,
    type: AccountType.ACCOUNT_ROTH_IRA,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    allowMargin: false,
    stateOfPlan: null,
  },
  {
    id: 3,
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name: 'Cash (no holdings)',
    institution: null,
    type: AccountType.ACCOUNT_CASH,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    allowMargin: false,
    stateOfPlan: null,
  },
];

const holdings: Holding[] = [
  { id: 1, accountId: 1, ticker: 'VTI', shareCount: 10, targetAllocationPct: null, costBasis: null },
  { id: 2, accountId: 2, ticker: 'VXUS', shareCount: 5, targetAllocationPct: null, costBasis: null },
];

const snapshots: AccountSnapshot[] = [
  { id: 1, accountId: 1, snapshotDate: '2026-01-15', totalValue: 5000, source: SnapshotSource.MANUAL },
  { id: 2, accountId: 1, snapshotDate: '2026-02-15', totalValue: 5500, source: SnapshotSource.MANUAL },
  { id: 3, accountId: 1, snapshotDate: '2026-03-15', totalValue: 6000, source: SnapshotSource.MANUAL },
  { id: 4, accountId: 2, snapshotDate: '2026-01-15', totalValue: 3000, source: SnapshotSource.MANUAL },
  { id: 5, accountId: 2, snapshotDate: '2026-02-15', totalValue: 3200, source: SnapshotSource.MANUAL },
  { id: 6, accountId: 2, snapshotDate: '2026-03-15', totalValue: 3400, source: SnapshotSource.MANUAL },
];

describe('InvestmentTimeSeriesChart', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the chart with default granularity = Months', () => {
    render(
      <div style={{ width: 800, height: 400 }}>
        <InvestmentTimeSeriesChart accounts={accounts} holdings={holdings} snapshots={snapshots} />
      </div>
    );
    // Title visible.
    expect(screen.getByText(/investments over time/i)).toBeInTheDocument();
    // Months button is the active one (aria-pressed=true).
    const monthsBtn = screen.getByRole('button', { name: /^months$/i });
    expect(monthsBtn).toHaveAttribute('aria-pressed', 'true');
    // Quarters button exists and is inactive.
    const quartersBtn = screen.getByRole('button', { name: /^quarters$/i });
    expect(quartersBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('changes granularity when a button is clicked + persists to localStorage', async () => {
    const user = userEvent.setup();
    render(
      <div style={{ width: 800, height: 400 }}>
        <InvestmentTimeSeriesChart accounts={accounts} holdings={holdings} snapshots={snapshots} />
      </div>
    );
    const quartersBtn = screen.getByRole('button', { name: /^quarters$/i });
    await user.click(quartersBtn);
    // After click, persisted value should be QUARTER.
    expect(getGranularity()).toBe('QUARTER');
    // And the Quarters button should now be active.
    expect(quartersBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens the account picker and toggling an account persists the selection', async () => {
    const user = userEvent.setup();
    render(
      <div style={{ width: 800, height: 400 }}>
        <InvestmentTimeSeriesChart accounts={accounts} holdings={holdings} snapshots={snapshots} />
      </div>
    );
    // Open the picker.
    const trigger = screen.getByRole('button', { name: /accounts/i });
    await user.click(trigger);
    // Picker dialog open.
    const picker = screen.getByRole('dialog', { name: /select accounts/i });
    // Both eligible accounts visible in the picker (Cash is not eligible — no holdings).
    expect(within(picker).getByLabelText(/brokerage/i)).toBeChecked();
    expect(within(picker).getByLabelText(/roth ira/i)).toBeChecked();
    expect(within(picker).queryByLabelText(/cash \(no holdings\)/i)).toBeNull();
    // Uncheck Brokerage.
    await user.click(within(picker).getByLabelText(/brokerage/i));
    // Persisted selection should now be just [2] (Roth IRA).
    expect(getSelectedAccounts()).toEqual([2]);
  });

  it('clicking a time window button persists to localStorage and re-renders', async () => {
    const user = userEvent.setup();
    render(
      <div style={{ width: 800, height: 400 }}>
        <InvestmentTimeSeriesChart accounts={accounts} holdings={holdings} snapshots={snapshots} />
      </div>
    );
    // Default window is ALL.
    const allBtn = screen.getByRole('button', { name: /^all$/i });
    expect(allBtn).toHaveAttribute('aria-pressed', 'true');
    // Click 1Y.
    const oneYearBtn = screen.getByRole('button', { name: /^1y$/i });
    await user.click(oneYearBtn);
    expect(getTimeWindow()).toBe('1Y');
    expect(oneYearBtn).toHaveAttribute('aria-pressed', 'true');
    expect(allBtn).toHaveAttribute('aria-pressed', 'false');
  });
});
