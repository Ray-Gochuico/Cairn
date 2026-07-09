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
import { seedDashboardGateStores } from './dashboard-gate-seed';

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
  seedDashboardGateStores();
  try { window.localStorage.removeItem('dashboardPillLayout.v1'); } catch { /* ignore */ }
  try { window.localStorage.removeItem('dashboardWidgetLayout.v1'); } catch { /* ignore */ }
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

describe('Dashboard "Customize layout" button', () => {
  beforeEach(() => {
    resetStores();
  });

  it('labels the toggle "Customize layout" when off and "Done" when on', () => {
    renderDashboard();
    const toggle = screen.getByTestId('dashboard-edit-toggle');
    expect(toggle).toHaveTextContent(/customize layout/i);
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent(/done/i);
  });

  it('includes a tooltip describing what the button does', () => {
    renderDashboard();
    const toggle = screen.getByTestId('dashboard-edit-toggle');
    const tooltip = toggle.getAttribute('title') ?? toggle.getAttribute('aria-label') ?? '';
    expect(tooltip.toLowerCase()).toMatch(/reorder|hide|widget|pill/);
  });
});

describe('Dashboard widget reposition', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders every dashboard widget under a stable data-widget-id wrapper', () => {
    renderDashboard();
    // The six widgets currently composed on the dashboard.
    expect(screen.getByTestId('widget-pills-section')).toBeInTheDocument();
    expect(screen.getByTestId('widget-asset-value-chart')).toBeInTheDocument();
    expect(screen.getByTestId('widget-spending')).toBeInTheDocument();
    expect(screen.getByTestId('widget-concentration')).toBeInTheDocument();
    expect(screen.getByTestId('widget-goals')).toBeInTheDocument();
    expect(screen.getByTestId('widget-trivia')).toBeInTheDocument();
  });

  it('trivia is a widget rendered LAST by default, not part of the prime row', () => {
    renderDashboard();
    const order = Array.from(document.querySelectorAll('[data-widget-id]')).map(
      (el) => el.getAttribute('data-widget-id'),
    );
    expect(order[order.length - 1]).toBe('trivia');
    // The trivia heading appears exactly once — inside the widget list, not
    // duplicated in a hard-coded prime row.
    const headings = screen.getAllByText(/today's questions/i);
    expect(headings).toHaveLength(1);
    expect(headings[0].closest('[data-widget-id]')?.getAttribute('data-widget-id')).toBe('trivia');
  });

  it('trivia can be hidden into the tray like any widget', () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    fireEvent.click(screen.getByTestId('widget-trivia-remove'));
    expect(screen.queryByTestId('widget-trivia')).toBeNull();
    expect(screen.getByTestId('widget-add-trivia')).toBeInTheDocument();
  });

  it('reveals widget move/remove controls only when editing is on', () => {
    renderDashboard();
    expect(screen.queryByTestId('widget-spending-remove')).toBeNull();
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    expect(screen.getByTestId('widget-spending-remove')).toBeInTheDocument();
    expect(screen.getByTestId('widget-concentration-up')).toBeInTheDocument();
    expect(screen.getByTestId('widget-goals-down')).toBeInTheDocument();
  });

  it('reorders widgets via the up/down chevrons', () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    // The spending widget is at index 2 by default (after pills-section and
    // asset-value-chart). Moving it up swaps it with asset-value-chart.
    const before = Array.from(document.querySelectorAll('[data-widget-id]')).map(
      (el) => el.getAttribute('data-widget-id'),
    );
    expect(before[0]).toBe('pills-section');
    expect(before[1]).toBe('asset-value-chart');
    expect(before[2]).toBe('spending');
    fireEvent.click(screen.getByTestId('widget-spending-up'));
    const after = Array.from(document.querySelectorAll('[data-widget-id]')).map(
      (el) => el.getAttribute('data-widget-id'),
    );
    expect(after[0]).toBe('pills-section');
    expect(after[1]).toBe('spending');
    expect(after[2]).toBe('asset-value-chart');
  });

  it('hides a widget and surfaces it under the Hidden widgets tray', () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    expect(screen.getByTestId('widget-spending')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('widget-spending-remove'));
    expect(screen.queryByTestId('widget-spending')).toBeNull();
    expect(screen.getByTestId('widget-add-spending')).toBeInTheDocument();
  });

  it('restores a hidden widget from the tray', () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    fireEvent.click(screen.getByTestId('widget-concentration-remove'));
    expect(screen.queryByTestId('widget-concentration')).toBeNull();
    fireEvent.click(screen.getByTestId('widget-add-concentration'));
    expect(screen.getByTestId('widget-concentration')).toBeInTheDocument();
  });

  it('disables the up arrow on the first widget and the down arrow on the last widget', () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    expect(screen.getByTestId('widget-pills-section-up')).toBeDisabled();
    // Trivia is the last widget by default (2026-07 hierarchy change).
    expect(screen.getByTestId('widget-trivia-down')).toBeDisabled();
    expect(screen.getByTestId('widget-goals-down')).not.toBeDisabled();
  });

  it('persists hidden widgets across remount via localStorage', () => {
    const { unmount } = renderDashboard();
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    fireEvent.click(screen.getByTestId('widget-spending-remove'));
    unmount();
    renderDashboard();
    expect(screen.queryByTestId('widget-spending')).toBeNull();
  });
});
