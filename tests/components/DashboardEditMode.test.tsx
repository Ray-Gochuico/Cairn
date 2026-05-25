import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useGoalsStore } from '@/stores/goals-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { FilingStatus } from '@/types/enums';
import type { GrowthScenario } from '@/types/schema';
import Dashboard from '@/pages/Dashboard';

const moderateScenarios: GrowthScenario[] = [
  { label: 'Conservative', rate: 0.05 },
  { label: 'Moderate', rate: 0.06 },
  { label: 'Optimistic', rate: 0.07 },
];

function resetStores() {
  useGoalsStore.setState({ goals: [], isLoading: false, error: null, load: async () => {} });
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: async () => {} });
  useContributionsStore.setState({ contributions: [], isLoading: false, error: null, load: async () => {} });
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
      city: null,
      monthlyExpenseBaseline: 5000,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: moderateScenarios,
    },
    isLoading: false,
    error: null,
  });
  useLoansStore.setState({ loans: [], isLoading: false, error: null, load: async () => {} });
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: async () => {} });
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: async () => {} });
  useTransactionsStore.setState({ transactions: [], isLoading: false, error: null, load: async () => {} });
  useCategoriesStore.setState({ categories: [], isLoading: false, error: null, load: async () => {} });
  // Each test starts from a clean layout (default order, nothing hidden).
  try { window.localStorage.removeItem('dashboardPillLayout.v1'); } catch { /* ignore */ }
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

describe('Dashboard edit mode', () => {
  beforeEach(() => {
    resetStores();
  });

  it('shows an Edit toggle button in the header that flips to "Done" when active', () => {
    renderDashboard();
    const toggle = screen.getByTestId('dashboard-edit-toggle');
    expect(toggle).toHaveTextContent(/edit/i);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent(/done/i);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('reveals remove/move controls on every pill only when editing is on', () => {
    renderDashboard();
    // Off by default: no remove button anywhere.
    expect(screen.queryByTestId('pill-net-worth-remove')).toBeNull();
    // Turn it on.
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    // Every default pill exposes a remove + move controls.
    expect(screen.getByTestId('pill-net-worth-remove')).toBeInTheDocument();
    expect(screen.getByTestId('pill-total-debt-up')).toBeInTheDocument();
    expect(screen.getByTestId('pill-spending-vs-budget-down')).toBeInTheDocument();
  });

  it('removes a pill from the grid when its X is clicked and surfaces it under "Hidden pills"', () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    // Confirm Net Worth pill is visible before removal.
    expect(screen.getByTestId('pill-net-worth')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pill-net-worth-remove'));
    // Pill drops out of the visible grid.
    expect(screen.queryByTestId('pill-net-worth')).toBeNull();
    // Hidden-pills tray surfaces a re-add chip for it.
    expect(screen.getByTestId('pill-add-net-worth')).toBeInTheDocument();
  });

  it('restores a hidden pill back into the grid when its "Add" chip is clicked', () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    fireEvent.click(screen.getByTestId('pill-total-debt-remove'));
    expect(screen.queryByTestId('pill-total-debt')).toBeNull();
    fireEvent.click(screen.getByTestId('pill-add-total-debt'));
    expect(screen.getByTestId('pill-total-debt')).toBeInTheDocument();
  });

  it('reorders pills via the up/down arrows', () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    // The "Total Debt" pill sits at index 1 by default. Move it up to index 0.
    fireEvent.click(screen.getByTestId('pill-total-debt-up'));
    // Inspect grid order — first child should now be the Total Debt pill.
    const grid = screen.getByTestId('dashboard-pill-grid');
    const firstPill = grid.querySelector('[data-pill-id]');
    expect(firstPill?.getAttribute('data-pill-id')).toBe('total-debt');
  });

  it('disables the up arrow on the first pill and the down arrow on the last pill', () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    expect(screen.getByTestId('pill-net-worth-up')).toBeDisabled();
    expect(screen.getByTestId('pill-spending-vs-budget-down')).toBeDisabled();
  });

  it('persists hidden pills across remount via localStorage', () => {
    const { unmount } = renderDashboard();
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    fireEvent.click(screen.getByTestId('pill-liquid-investments-remove'));
    unmount();
    // Mount fresh — localStorage should re-seed Liquid Investments as hidden.
    renderDashboard();
    expect(screen.queryByTestId('pill-liquid-investments')).toBeNull();
  });
});
