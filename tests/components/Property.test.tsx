import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { usePropertiesStore } from '@/stores/properties-store';
import { useLoansStore } from '@/stores/loans-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { FilingStatus, PropertyType } from '@/types/enums';
import Property from '@/pages/Property';

function resetStores() {
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: async () => {} });
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
      <Property />
    </MemoryRouter>,
  );
}

describe('Property page', () => {
  beforeEach(() => {
    resetStores();
  });

  it('shows empty-state when there are no properties', () => {
    renderPage();
    expect(screen.getByText(/Property/i)).toBeInTheDocument();
    expect(screen.getByText(/Add properties from/i)).toBeInTheDocument();
  });

  it('renders a property card with name and current value', () => {
    usePropertiesStore.setState({
      properties: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: null,
          name: 'Main Home',
          type: PropertyType.PRIMARY_RESIDENCE,
          address: '123 Main St',
          purchasePrice: 400000,
          purchaseDate: '2020-01-01',
          currentEstimatedValue: 500000,
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

    expect(screen.getByText('Main Home')).toBeInTheDocument();
    expect(screen.getAllByText('$500,000').length).toBeGreaterThan(0);
  });

  it('renders purchase price and cost basis row', () => {
    usePropertiesStore.setState({
      properties: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: null,
          name: 'Rental Property',
          type: PropertyType.PRIMARY_RESIDENCE,
          address: null,
          purchasePrice: 300000,
          purchaseDate: '2019-06-01',
          currentEstimatedValue: 350000,
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

    expect(screen.getAllByText('$300,000').length).toBeGreaterThan(0);
    // Cost basis label should exist
    expect(screen.getByText(/cost basis/i)).toBeInTheDocument();
    // Subtext indicating purchase price + capital improvements
    expect(screen.getByText(/purchase price \+ capital improvements/i)).toBeInTheDocument();
  });

  it('cost basis includes capital-improvement transactions linked to the property', () => {
    usePropertiesStore.setState({
      properties: [
        {
          id: 7,
          householdId: 1,
          ownerPersonId: null,
          name: 'My Home',
          type: PropertyType.PRIMARY_RESIDENCE,
          address: null,
          purchasePrice: 400000,
          purchaseDate: '2020-01-01',
          currentEstimatedValue: 450000,
          linkedLoanId: null,
          excludedFromNetWorth: false,
          notes: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    // Category 12 = Capital Improvements (isCapital = true)
    useCategoriesStore.setState({
      categories: [
        {
          id: 12,
          name: 'Capital Improvements',
          parentCategoryId: 1,
          color: null,
          icon: null,
          type: 'NEED',
          isCapital: true,
          systemManaged: false,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    // A $5,000 capital-improvement transaction linked to property 7
    useTransactionsStore.setState({
      transactions: [
        {
          id: 1,
          householdId: 1,
          date: '2026-01-15',
          merchant: 'Kitchen Remodel',
          merchantRaw: 'Kitchen Remodel',
          amount: 5000,
          categoryId: 12,
          sourceAccountId: null,
          propertyId: 7,
          vehicleId: null,
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

    // Cost basis = $400,000 purchase price + $5,000 capital improvement = $405,000
    expect(screen.getAllByText('$405,000').length).toBeGreaterThan(0);
  });
});
