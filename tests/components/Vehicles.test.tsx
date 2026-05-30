import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import {
  FilingStatus,
  RefreshCadence,
  FiPillsPosition,
  ProjectionDetailLevel,
  CompoundingFrequency,
  CategoryType,
} from '@/types/enums';
import type { AppSettings, Category, Transaction } from '@/types/schema';
import Vehicles from '@/pages/Vehicles';

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
  useVehicleLeasesStore.setState({
    vehicleLeases: [],
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

const VEHICLES_AND_GAS: Category[] = [
  baseCat({ id: 2, name: 'Vehicles' }),
  baseCat({ id: 17, name: 'Gas/Fuel', parentCategoryId: 2 }),
  baseCat({ id: 18, name: 'Auto Insurance', parentCategoryId: 2 }),
];

function seedVehicleWithGas(): void {
  useVehiclesStore.setState({
    vehicles: [
      {
        id: 5,
        householdId: 1,
        ownerPersonId: null,
        name: 'My Car',
        make: 'Toyota',
        model: 'RAV4',
        year: 2022,
        purchasePrice: 35000,
        purchaseDate: '2022-03-01',
        currentEstimatedValue: 28000,
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
    categories: VEHICLES_AND_GAS,
    isLoading: false,
    error: null,
    load: async () => {},
  } as never);
}

function seedGasTransactions(transactions: Transaction[]): void {
  useTransactionsStore.setState({
    transactions,
    isLoading: false,
    error: null,
    load: async () => {},
  } as never);
}

function makeGasTx(
  id: number,
  date: string,
  amount: number,
  categoryId: number,
): Transaction {
  return {
    id,
    householdId: 1,
    date,
    merchant: 'Gas Station',
    merchantRaw: 'Gas Station',
    amount,
    categoryId,
    sourceAccountId: null,
    propertyId: null,
    vehicleId: 5,
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
    expect(screen.getByText(/Add vehicles or leases from/i)).toBeInTheDocument();
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

    // The vehicle name now appears in three cards: the Asset card title and
    // the Expenses/Gas card descriptions.
    expect(screen.getAllByText('Family SUV').length).toBeGreaterThan(0);
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
    // when the Vehicle card was split into Asset / Expenses / Gas.
    expect(screen.getByText(/12-mo rolling/i)).toBeInTheDocument();
    // $350 linked to vehicle 5 is within 12 months
    expect(screen.getAllByText('$350').length).toBeGreaterThan(0);
  });

  it('renders the Value history section per vehicle', () => {
    useVehiclesStore.setState({
      vehicles: [
        {
          id: 17,
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
        } as never,
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    renderPage();

    // Empty-state copy from ValueHistorySection
    expect(screen.getByText(/Using current estimated value/i)).toBeInTheDocument();
    expect(screen.getByText(/Value history \(0\)/i)).toBeInTheDocument();
  });

  it('renders a lease card and total monthly obligation when vehicle leases exist', async () => {
    useVehicleLeasesStore.setState({
      vehicleLeases: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: null,
          name: 'Tesla Model 3',
          monthlyAmount: 599,
          startDate: '2025-01-01',
          endDate: '2028-12-31',
        },
        {
          id: 2,
          householdId: 1,
          ownerPersonId: null,
          name: 'BMW i4',
          monthlyAmount: 700,
          startDate: '2025-06-01',
          endDate: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);

    renderPage();

    expect(await screen.findByText('Tesla Model 3')).toBeInTheDocument();
    expect(screen.getByText('BMW i4')).toBeInTheDocument();
    // 599 + 700 = 1299
    expect(screen.getByText(/Total recurring vehicle/i)).toBeInTheDocument();
    expect(screen.getByText(/\$1,299/)).toBeInTheDocument();
  });

  it('renders the owner person tag on a lease card', async () => {
    usePersonsStore.setState({
      persons: [
        { id: 1, name: 'Alex' },
        { id: 2, name: 'Sam' },
      ] as never,
      isLoading: false,
      error: null,
      load: async () => {},
    });
    useVehicleLeasesStore.setState({
      vehicleLeases: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: 2,
          name: 'Commuter EV',
          monthlyAmount: 450,
          startDate: '2025-03-01',
          endDate: '2028-02-28',
        },
        {
          id: 2,
          householdId: 1,
          ownerPersonId: null,
          name: 'Work van',
          monthlyAmount: 600,
          startDate: '2025-01-01',
          endDate: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);

    renderPage();

    expect(await screen.findByText('Commuter EV')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('Joint')).toBeInTheDocument();
  });

  it('renders an Edit link to Inputs on a lease card', async () => {
    useVehicleLeasesStore.setState({
      vehicleLeases: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: null,
          name: 'Commuter EV',
          monthlyAmount: 450,
          startDate: '2025-03-01',
          endDate: '2028-02-28',
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);

    renderPage();

    await screen.findByText('Commuter EV');
    const editLink = screen.getByRole('link', { name: /edit lease/i });
    expect(editLink).toHaveAttribute('href', '/inputs/vehicle-leases');
    expect(screen.getByRole('button', { name: /^Remove$/i })).toBeInTheDocument();
  });

  it('renders the leases total as an aggregate card with a per-mo figure and meta', async () => {
    useVehicleLeasesStore.setState({
      vehicleLeases: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: null,
          name: 'Commuter EV',
          monthlyAmount: 450,
          startDate: '2025-03-01',
          endDate: '2028-02-28',
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);

    renderPage();

    await screen.findByText('Commuter EV');
    expect(screen.getByText(/Total recurring vehicle/i)).toBeInTheDocument();
    expect(screen.getByText(/feeds Spending/i)).toBeInTheDocument();
    expect(screen.getAllByText(/\$450/).length).toBeGreaterThan(0);
  });

  it('renders an on-page Add lease affordance linking to Inputs', async () => {
    useVehicleLeasesStore.setState({
      vehicleLeases: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: null,
          name: 'Commuter EV',
          monthlyAmount: 450,
          startDate: '2025-03-01',
          endDate: '2028-02-28',
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);

    renderPage();

    await screen.findByText('Commuter EV');
    const addLink = screen.getByRole('link', { name: /add lease/i });
    expect(addLink).toHaveAttribute('href', '/inputs/vehicle-leases');
  });

  it('exports the full vehicles table to CSV with the owner name resolved', async () => {
    usePersonsStore.setState({
      persons: [
        { id: 1, name: 'Alex' },
        { id: 2, name: 'Sam' },
      ] as never,
      isLoading: false,
      error: null,
      load: async () => {},
    });
    useVehiclesStore.setState({
      vehicles: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: 2,
          name: 'Family SUV',
          make: 'Toyota',
          model: 'RAV4',
          year: 2022,
          purchaseDate: '2022-03-01',
          purchasePrice: 35000,
          currentEstimatedValue: 28000,
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
      'name,year,make,model,purchase date,purchase price,current value,owner',
    );
    expect(capturedCsv.split('\n')[1]).toBe(
      'Family SUV,2022,Toyota,RAV4,2022-03-01,35000,28000,Sam',
    );

    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });
});

describe('Vehicles page — gas card with configurable category set', () => {
  beforeEach(() => {
    resetStores();
  });

  it('uses the seeded "Vehicles > Gas/Fuel" when vehicleGasCategoryIds is null', () => {
    seedVehicleWithGas();
    // Single $40 gas tx today (this month) → avg $40/mo over 1 month.
    seedGasTransactions([makeGasTx(1, '2026-05-15', 40, 17)]);
    useSettingsStore.setState({
      settings: makeSettings({ vehicleGasCategoryIds: null }),
      isLoading: false,
      error: null,
      load: async () => {},
      update: async () => {},
    } as never);

    renderPage();

    // Card title "Gas" appears as text + $40 in the card body.
    expect(screen.getAllByText(/^Gas$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('$40').length).toBeGreaterThan(0);
  });

  it('sums across multiple configured gas categories', () => {
    seedVehicleWithGas();
    // Pin both transactions to the same recent month → total $90 / 1 month.
    seedGasTransactions([
      makeGasTx(1, '2026-05-15', 40, 17),
      makeGasTx(2, '2026-05-15', 50, 18),
    ]);
    useSettingsStore.setState({
      settings: makeSettings({ vehicleGasCategoryIds: [17, 18] }),
      isLoading: false,
      error: null,
      load: async () => {},
      update: async () => {},
    } as never);

    renderPage();

    expect(screen.getAllByText('$90').length).toBeGreaterThan(0);
  });

  it('shows the empty state when vehicleGasCategoryIds = []', () => {
    seedVehicleWithGas();
    useSettingsStore.setState({
      settings: makeSettings({ vehicleGasCategoryIds: [] }),
      isLoading: false,
      error: null,
      load: async () => {},
      update: async () => {},
    } as never);

    renderPage();

    expect(screen.getByText(/no categories configured/i)).toBeInTheDocument();
  });

  it('renders an inline picker that opens an inline popover with gas categories', async () => {
    const user = userEvent.setup();
    seedVehicleWithGas();
    useSettingsStore.setState({
      settings: makeSettings(),
      isLoading: false,
      error: null,
      load: async () => {},
      update: async () => {},
    } as never);

    renderPage();

    const trigger = screen.getByRole('button', { name: /edit gas categories/i });
    expect(trigger).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Gas\/Fuel$/)).toBeInTheDocument();
  });

  it('saves an inline picker selection to the settings store', async () => {
    const user = userEvent.setup();
    seedVehicleWithGas();
    const update = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({
      settings: makeSettings(),
      isLoading: false,
      error: null,
      load: async () => {},
      update,
    } as never);

    renderPage();

    await user.click(screen.getByRole('button', { name: /edit gas categories/i }));
    await user.click(screen.getByLabelText(/^Auto Insurance$/));
    expect(update).toHaveBeenCalledWith({ vehicleGasCategoryIds: [18] });
  });
});
