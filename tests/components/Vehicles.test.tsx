import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { FilingStatus } from '@/types/enums';
import Vehicles from '@/pages/Vehicles';

function resetStores() {
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: async () => {} });
  useLoansStore.setState({ loans: [], isLoading: false, error: null, load: async () => {} });
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
      city: null,
      monthlyExpenseBaseline: 5000,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: [],
    },
    isLoading: false,
    error: null,
  });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null, load: async () => {} });
  useTransactionsStore.setState({ transactions: [], isLoading: false, error: null, load: async () => {} });
  useCategoriesStore.setState({ categories: [], isLoading: false, error: null, load: async () => {} });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Vehicles />
    </MemoryRouter>,
  );
}

describe('Vehicles page', () => {
  beforeEach(() => {
    resetStores();
  });

  it('shows empty-state when there are no vehicles', () => {
    renderPage();
    expect(screen.getAllByText(/Vehicles/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Add vehicles from/i)).toBeInTheDocument();
  });

  it('renders a vehicle card with name and current value', () => {
    useVehiclesStore.setState({
      vehicles: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: null,
          name: 'Family SUV',
          make: 'Toyota',
          model: 'RAV4',
          year: 2022,
          purchasePrice: 35000,
          purchaseDate: '2022-03-01',
          currentEstimatedValue: 28000,
          linkedLoanId: null,
          excludedFromNetWorth: false,
          notes: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    renderPage();

    expect(screen.getByText('Family SUV')).toBeInTheDocument();
    expect(screen.getAllByText('$28,000').length).toBeGreaterThan(0);
    expect(screen.getByText('2022 Toyota RAV4')).toBeInTheDocument();
  });

  it('renders equity row with correct value', () => {
    useVehiclesStore.setState({
      vehicles: [
        {
          id: 2,
          householdId: 1,
          ownerPersonId: null,
          name: 'Sedan',
          make: 'Honda',
          model: 'Accord',
          year: 2021,
          purchasePrice: 28000,
          purchaseDate: '2021-01-01',
          currentEstimatedValue: 20000,
          linkedLoanId: null,
          excludedFromNetWorth: false,
          notes: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    renderPage();

    expect(screen.getAllByText(/equity/i).length).toBeGreaterThan(0);
    // $20,000 equity (no loan linked)
    expect(screen.getAllByText('$20,000').length).toBeGreaterThan(0);
  });

  it('shows rolling-12-month expense from vehicle-linked transactions', () => {
    useVehiclesStore.setState({
      vehicles: [
        {
          id: 5,
          householdId: 1,
          ownerPersonId: null,
          name: 'SUV',
          make: 'Ford',
          model: 'Explorer',
          year: 2023,
          purchasePrice: 42000,
          purchaseDate: '2023-01-01',
          currentEstimatedValue: 38000,
          linkedLoanId: null,
          excludedFromNetWorth: false,
          notes: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    useTransactionsStore.setState({
      transactions: [
        {
          id: 1,
          householdId: 1,
          date: '2026-01-10',
          merchant: 'Auto Service',
          merchantRaw: 'Auto Service',
          amount: 350,
          categoryId: null,
          sourceAccountId: null,
          propertyId: null,
          vehicleId: 5,
          sourcePdfFilename: null,
          reimbursable: false,
          reimbursedAt: null,
          reimbursedAmount: null,
          isRecurring: false,
          notes: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    renderPage();

    // The 12-mo expense row should appear
    expect(screen.getByText(/12-mo expense/i)).toBeInTheDocument();
    // $350 linked to vehicle 5 is within 12 months
    expect(screen.getAllByText('$350').length).toBeGreaterThan(0);
  });
});
