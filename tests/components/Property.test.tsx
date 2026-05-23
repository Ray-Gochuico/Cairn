import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

    // The property name now appears in three cards: the Asset card title and
    // the Expenses/Utilities card descriptions.
    expect(screen.getAllByText('Main Home').length).toBeGreaterThan(0);
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
          personId: null,
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

  it('renders the rolling-12-month expense from property-linked transactions', () => {
    usePropertiesStore.setState({
      properties: [
        {
          id: 7,
          householdId: 1,
          ownerPersonId: null,
          name: 'My Home',
          type: PropertyType.PRIMARY_RESIDENCE,
          address: null,
          purchasePrice: 300000,
          purchaseDate: '2020-01-01',
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

    useCategoriesStore.setState({
      categories: [
        {
          id: 11,
          name: 'Home Maintenance',
          parentCategoryId: 1,
          color: null,
          icon: null,
          type: 'NEED',
          isCapital: false,
          systemManaged: false,
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
          date: '2026-01-15',
          merchant: 'Plumber',
          merchantRaw: 'Plumber',
          amount: 750,
          categoryId: 11,
          sourceAccountId: null,
          propertyId: 7,
          vehicleId: null,
          personId: null,
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

    // The Expenses card surfaces both the rolling-12mo and annual-average
    // stats. The label was renamed from "12-mo expense" to "12-mo rolling"
    // when the Property card was split into Asset / Expenses / Utilities.
    expect(screen.getByText(/12-mo rolling/i)).toBeInTheDocument();
    // $750 maintenance transaction linked to property 7 within 12 months
    expect(screen.getAllByText('$750').length).toBeGreaterThan(0);
  });

  it('exports the full properties table to CSV with the owner name resolved', async () => {
    usePersonsStore.setState({
      persons: [
        { id: 1, name: 'Alex' },
        { id: 2, name: 'Sam' },
      ] as never,
      isLoading: false,
      error: null,
      load: async () => {},
    });
    usePropertiesStore.setState({
      properties: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: 1,
          name: 'Main Home',
          type: PropertyType.PRIMARY_RESIDENCE,
          address: '123 Main St',
          purchaseDate: '2020-01-01',
          purchasePrice: 400000,
          currentEstimatedValue: 500000,
          linkedLoanId: null,
          excludedFromNetWorth: false,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    let capturedCsv = '';
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      void (b as Blob).text().then((t) => {
        capturedCsv = t;
      });
      return 'blob:mock';
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await Promise.resolve();

    expect(capturedCsv.split('\n')[0]).toBe(
      'name,type,address,purchase date,purchase price,current value,owner',
    );
    expect(capturedCsv.split('\n')[1]).toBe(
      'Main Home,Primary residence,123 Main St,2020-01-01,400000,500000,Alex',
    );

    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });
});
