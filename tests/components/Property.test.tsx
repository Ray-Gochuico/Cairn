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
import { useSettingsStore } from '@/stores/settings-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import {
  FilingStatus,
  PropertyType,
  RefreshCadence,
  FiPillsPosition,
  ProjectionDetailLevel,
  CompoundingFrequency,
  CategoryType,
} from '@/types/enums';
import type { AppSettings, Category, Transaction } from '@/types/schema';
import Property from '@/pages/Property';

function makeSettings(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    id: 1,
    sidebarLayout: null,
    notificationsEnabled: true,
    notificationDay: 1,
    refreshCadence: RefreshCadence.EVERY_LAUNCH,
    lastRefreshAt: null,
    statementsFolderPath: null,
    defaultInflation: null,
    defaultReturnRate: null,
    defaultFiPillsPosition: FiPillsPosition.ABOVE,
    defaultProjectionDetailLevel: ProjectionDetailLevel.TAX_BUCKET,
    defaultCashApy: null,
    defaultCompoundingFrequency: CompoundingFrequency.MONTHLY,
    propertyUtilitiesCategoryIds: null,
    vehicleGasCategoryIds: null,
    ...patch,
  };
}

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
  useSettingsStore.setState({
    settings: makeSettings(),
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
  } as never);
  useAssetValueSnapshotsStore.setState({
    assetValueSnapshots: [],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useHousingPaymentsStore.setState({
    housingPayments: [],
    isLoading: false,
    error: null,
    load: async () => {},
  } as never);
}

const baseCat = (overrides: Partial<Category>): Category => ({
  id: 0,
  name: '',
  parentCategoryId: null,
  color: null,
  icon: null,
  type: CategoryType.NEED,
  isCapital: false,
  systemManaged: false,
  monthlyBudget: null,
  ...overrides,
});

const HOME_AND_UTILITIES: Category[] = [
  baseCat({ id: 1, name: 'Home' }),
  baseCat({ id: 10, name: 'Utilities', parentCategoryId: 1 }),
  baseCat({ id: 11, name: 'Internet', parentCategoryId: 1 }),
];

function seedPropertyWithUtilities(): void {
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
      } as never,
    ],
    isLoading: false,
    error: null,
    load: async () => {},
  } as never);
  useCategoriesStore.setState({
    categories: HOME_AND_UTILITIES,
    isLoading: false,
    error: null,
    load: async () => {},
  } as never);
}

function seedUtilitiesTransactions(transactions: Transaction[]): void {
  useTransactionsStore.setState({
    transactions,
    isLoading: false,
    error: null,
    load: async () => {},
  } as never);
}

function makeUtilitiesTx(
  id: number,
  date: string,
  amount: number,
  categoryId: number,
): Transaction {
  return {
    id,
    householdId: 1,
    date,
    merchant: 'Utility Co',
    merchantRaw: 'Utility Co',
    amount,
    categoryId,
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
  };
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
    expect(screen.getByText(/Add properties or rentals from/i)).toBeInTheDocument();
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

  it('renders the Value history section per property', () => {
    usePropertiesStore.setState({
      properties: [
        {
          id: 42,
          householdId: 1,
          ownerPersonId: null,
          name: 'Family Home',
          type: PropertyType.PRIMARY_RESIDENCE,
          address: null,
          purchasePrice: 400000,
          purchaseDate: '2020-01-01',
          currentEstimatedValue: 450000,
          linkedLoanId: null,
          excludedFromNetWorth: false,
        } as never,
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    renderPage();

    // Empty-state copy from ValueHistorySection
    expect(screen.getByText(/Using current estimated value/i)).toBeInTheDocument();
    // The summary label confirms section is mounted
    expect(screen.getByText(/Value history \(0\)/i)).toBeInTheDocument();
  });

  it('renders a rental card and total monthly obligation when housing payments exist', async () => {
    useHousingPaymentsStore.setState({
      housingPayments: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: null,
          name: 'Brooklyn apt',
          monthlyAmount: 2400,
          startDate: '2025-01-01',
          endDate: null,
        },
        {
          id: 2,
          householdId: 1,
          ownerPersonId: null,
          name: 'Storage unit',
          monthlyAmount: 150,
          startDate: '2025-06-01',
          endDate: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);

    renderPage();

    expect(await screen.findByText('Brooklyn apt')).toBeInTheDocument();
    expect(screen.getByText('Storage unit')).toBeInTheDocument();
    // 2400 + 150 = 2550
    expect(screen.getByText(/Total recurring housing/i)).toBeInTheDocument();
    expect(screen.getByText(/\$2,550/)).toBeInTheDocument();
  });

  it('renders the owner person tag on a rental card', async () => {
    usePersonsStore.setState({
      persons: [
        { id: 1, name: 'Alex' },
        { id: 2, name: 'Sam' },
      ] as never,
      isLoading: false,
      error: null,
      load: async () => {},
    });
    useHousingPaymentsStore.setState({
      housingPayments: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: 1,
          name: 'Downtown apartment',
          monthlyAmount: 2400,
          startDate: '2025-09-01',
          endDate: null,
        },
        {
          id: 2,
          householdId: 1,
          ownerPersonId: null,
          name: 'Storage unit',
          monthlyAmount: 95,
          startDate: '2024-02-01',
          endDate: '2026-06-30',
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);

    renderPage();

    // Owner-scoped rental shows the person's name; joint rental shows "Joint".
    expect(await screen.findByText('Downtown apartment')).toBeInTheDocument();
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('Joint')).toBeInTheDocument();
  });

  it('renders an Edit link to Inputs on a rental card', async () => {
    useHousingPaymentsStore.setState({
      housingPayments: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: null,
          name: 'Downtown apartment',
          monthlyAmount: 2400,
          startDate: '2025-09-01',
          endDate: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);

    renderPage();

    await screen.findByText('Downtown apartment');
    const editLink = screen.getByRole('link', { name: /edit rental/i });
    expect(editLink).toHaveAttribute('href', '/inputs/housing-payments');
    // Remove still present.
    expect(screen.getByRole('button', { name: /^Remove$/i })).toBeInTheDocument();
  });

  it('renders the rentals total as an aggregate card with a per-mo figure and meta', async () => {
    useHousingPaymentsStore.setState({
      housingPayments: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: null,
          name: 'Downtown apartment',
          monthlyAmount: 2400,
          startDate: '2025-09-01',
          endDate: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);

    renderPage();

    await screen.findByText('Downtown apartment');
    // The aggregate's eyebrow label and meta line distinguish the card from
    // the old inline header text.
    expect(screen.getByText(/Total recurring housing/i)).toBeInTheDocument();
    expect(screen.getByText(/feeds Spending/i)).toBeInTheDocument();
    expect(screen.getAllByText(/\$2,400/).length).toBeGreaterThan(0);
  });

  it('renders an on-page Add rental affordance linking to Inputs', async () => {
    useHousingPaymentsStore.setState({
      housingPayments: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: null,
          name: 'Downtown apartment',
          monthlyAmount: 2400,
          startDate: '2025-09-01',
          endDate: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);

    renderPage();

    await screen.findByText('Downtown apartment');
    const addLink = screen.getByRole('link', { name: /add rental/i });
    expect(addLink).toHaveAttribute('href', '/inputs/housing-payments');
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

describe('Property page — utilities card with configurable category set', () => {
  beforeEach(() => {
    resetStores();
  });

  it('uses the seeded "Home > Utilities" when propertyUtilitiesCategoryIds is null', () => {
    seedPropertyWithUtilities();
    // Single $100 utilities tx today (this month) → avg $100/mo over 1 month.
    seedUtilitiesTransactions([makeUtilitiesTx(1, '2026-05-15', 100, 10)]);
    useSettingsStore.setState({
      settings: makeSettings({ propertyUtilitiesCategoryIds: null }),
      isLoading: false,
      error: null,
      load: async () => {},
      update: async () => {},
    } as never);

    renderPage();

    // Card title "Utilities" appears as text + $100 in the card body.
    expect(screen.getAllByText(/^Utilities$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('$100').length).toBeGreaterThan(0);
  });

  it('sums across multiple configured category ids', () => {
    seedPropertyWithUtilities();
    // Pin both transactions to the same recent month → total $150 / 1 month
    // = $150/mo average.
    seedUtilitiesTransactions([
      makeUtilitiesTx(1, '2026-05-15', 100, 10),
      makeUtilitiesTx(2, '2026-05-15', 50, 11),
    ]);
    useSettingsStore.setState({
      settings: makeSettings({ propertyUtilitiesCategoryIds: [10, 11] }),
      isLoading: false,
      error: null,
      load: async () => {},
      update: async () => {},
    } as never);

    renderPage();

    // $100 utilities + $50 internet, same month = $150/mo average.
    expect(screen.getAllByText('$150').length).toBeGreaterThan(0);
  });

  it('shows the empty state when propertyUtilitiesCategoryIds = []', () => {
    seedPropertyWithUtilities();
    useSettingsStore.setState({
      settings: makeSettings({ propertyUtilitiesCategoryIds: [] }),
      isLoading: false,
      error: null,
      load: async () => {},
      update: async () => {},
    } as never);

    renderPage();

    expect(screen.getByText(/no categories configured/i)).toBeInTheDocument();
  });

  it('renders an inline picker that opens an inline popover with utilities categories', async () => {
    const user = userEvent.setup();
    seedPropertyWithUtilities();
    useSettingsStore.setState({
      settings: makeSettings(),
      isLoading: false,
      error: null,
      load: async () => {},
      update: async () => {},
    } as never);

    renderPage();

    const trigger = screen.getByRole('button', { name: /edit utilities categories/i });
    expect(trigger).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Utilities$/)).toBeInTheDocument();
  });

  it('saves an inline picker selection to the settings store', async () => {
    const user = userEvent.setup();
    seedPropertyWithUtilities();
    const update = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({
      settings: makeSettings(),
      isLoading: false,
      error: null,
      load: async () => {},
      update,
    } as never);

    renderPage();

    await user.click(
      screen.getByRole('button', { name: /edit utilities categories/i }),
    );
    await user.click(screen.getByLabelText(/^Internet$/));
    expect(update).toHaveBeenCalledWith({ propertyUtilitiesCategoryIds: [11] });
  });
});
