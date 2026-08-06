import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useAccountsStore } from '@/stores/accounts-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import Section2_WhatYouOwn from '@/pages/setup/Section2_WhatYouOwn';

function resetStores() {
  const base = {
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  };
  useAccountsStore.setState({ accounts: [], ...base } as any);
  useHoldingsStore.setState({ holdings: [], ...base } as any);
  usePropertiesStore.setState({ properties: [], ...base } as any);
  useVehiclesStore.setState({ vehicles: [], ...base } as any);
  useHousingPaymentsStore.setState({ housingPayments: [], ...base } as any);
  useVehicleLeasesStore.setState({ vehicleLeases: [], ...base } as any);
  useEquityGrantsStore.setState({ equityGrants: [], ...base } as any);
  usePersonsStore.setState({ persons: [{ id: 1, name: 'Alice' }], ...base } as any);
  useLoansStore.setState({ loans: [], ...base } as any);
  // ImportCsvButton subscribes to these stores for ValidationContext —
  // seed empty arrays so the component mounts without errors.
  useCategoriesStore.setState({ categories: [], ...base } as any);
  useSnapshotsStore.setState({
    snapshots: [],
    ...base,
    upsert: async () => 1,
    refresh: async () => {},
  } as any);
  useTransactionsStore.setState({ transactions: [], ...base } as any);
  useContributionsStore.setState({ contributions: [], ...base } as any);
  useAssetValueSnapshotsStore.setState({
    assetValueSnapshots: [],
    ...base,
    removeForOwner: async () => {},
  } as any);
}

/**
 * Find the EntityCard container by matching its title heading. EntityCard
 * renders a shadcn <Card> whose root has a class containing "rounded".
 */
function findCard(title: RegExp): HTMLElement {
  const heading = screen.getByText(title);
  const card = heading.closest('div[class*="rounded"]');
  if (!card) throw new Error(`Card not found for ${title}`);
  return card as HTMLElement;
}

describe('Section2_WhatYouOwn', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the entry gate when status is pending', () => {
    render(
      <MemoryRouter>
        <Section2_WhatYouOwn hasData={false} settled status="pending" onSetStatus={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Your assets/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /start this section/i }),
    ).toBeInTheDocument();
  });

  it('renders the seven cards when status is in_progress', () => {
    render(
      <MemoryRouter>
        <Section2_WhatYouOwn hasData={false} settled status="in_progress" onSetStatus={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/^Accounts$/)).toBeInTheDocument();
    expect(screen.getByText(/^Holdings$/)).toBeInTheDocument();
    expect(screen.getByText(/^Properties$/)).toBeInTheDocument();
    expect(screen.getByText(/^Rent \/ housing payment$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Vehicles$/)).toBeInTheDocument();
    expect(screen.getByText(/^Vehicle lease$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Equity grants$/i)).toBeInTheDocument();
  });

  it('clicking Start this section flips status to in_progress', async () => {
    const user = userEvent.setup();
    const onSetStatus = vi.fn();
    render(
      <MemoryRouter>
        <Section2_WhatYouOwn hasData={false} settled status="pending" onSetStatus={onSetStatus} />
      </MemoryRouter>,
    );
    await user.click(
      screen.getByRole('button', { name: /start this section/i }),
    );
    expect(onSetStatus).toHaveBeenCalledWith('in_progress');
  });

  it('clicking Skip flips status to skipped', async () => {
    const user = userEvent.setup();
    const onSetStatus = vi.fn();
    render(
      <MemoryRouter>
        <Section2_WhatYouOwn hasData={false} settled status="pending" onSetStatus={onSetStatus} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSetStatus).toHaveBeenCalledWith('skipped');
  });

  describe('created-entity chips', () => {
    it('renders named chips for every entity type added in this section', () => {
      const base = {
        isLoading: false,
        error: null,
        load: async () => {},
        create: async () => 1,
        update: async () => {},
        remove: async () => {},
      };
      useAccountsStore.setState({
        accounts: [
          { id: 1, name: 'Fidelity Brokerage' },
          { id: 2, name: 'Chase Checking' },
        ],
        ...base,
      } as any);
      useHoldingsStore.setState({
        holdings: [{ id: 1, accountId: 1, ticker: 'VTI', shareCount: 10 }],
        ...base,
      } as any);
      usePropertiesStore.setState({
        properties: [{ id: 1, name: 'Maple St house' }],
        ...base,
      } as any);
      useHousingPaymentsStore.setState({
        housingPayments: [{ id: 1, name: 'Apartment rent' }],
        ...base,
      } as any);
      useVehiclesStore.setState({
        vehicles: [{ id: 1, name: 'Corolla' }],
        ...base,
      } as any);
      useVehicleLeasesStore.setState({
        vehicleLeases: [{ id: 1, name: 'Leaf lease' }],
        ...base,
      } as any);
      useEquityGrantsStore.setState({
        equityGrants: [{ id: 1, name: 'RSU 2024' }],
        ...base,
      } as any);
      render(
        <MemoryRouter>
          <Section2_WhatYouOwn hasData={false} settled status="in_progress" onSetStatus={() => {}} />
        </MemoryRouter>,
      );
      const chipsOf = (testId: string) => screen.getByTestId(testId);
      expect(within(chipsOf('accounts-chips')).getByText('Fidelity Brokerage')).toBeInTheDocument();
      expect(within(chipsOf('accounts-chips')).getByText('Chase Checking')).toBeInTheDocument();
      // Wave C C5 (CW5): holding chips are account-qualified.
      expect(within(chipsOf('holdings-chips')).getByText('VTI · Fidelity Brokerage')).toBeInTheDocument();
      expect(within(chipsOf('properties-chips')).getByText('Maple St house')).toBeInTheDocument();
      expect(
        within(chipsOf('rent-housing-payment-chips')).getByText('Apartment rent'),
      ).toBeInTheDocument();
      expect(within(chipsOf('vehicles-chips')).getByText('Corolla')).toBeInTheDocument();
      expect(within(chipsOf('vehicle-lease-chips')).getByText('Leaf lease')).toBeInTheDocument();
      expect(within(chipsOf('equity-grants-chips')).getByText('RSU 2024')).toBeInTheDocument();
    });

    it('renders no chip containers when nothing has been added', () => {
      render(
        <MemoryRouter>
          <Section2_WhatYouOwn hasData={false} settled status="in_progress" onSetStatus={() => {}} />
        </MemoryRouter>,
      );
      expect(screen.queryByTestId('accounts-chips')).toBeNull();
      expect(screen.queryByTestId('holdings-chips')).toBeNull();
    });
  });

  describe('Section2_WhatYouOwn — import buttons enabled', () => {
    beforeEach(() => {
      // Holdings import is gated until at least one account exists (W7).
      // Seed one account so the import buttons render enabled in this group.
      useAccountsStore.setState((s: any) => ({ ...s, accounts: [{ id: 1, name: 'Test Account' }] }));
    });

    function renderSection() {
      render(
        <MemoryRouter>
          <Section2_WhatYouOwn hasData={false} settled status="in_progress" onSetStatus={() => {}} />
        </MemoryRouter>,
      );
    }

    it('Accounts card has a functional Import CSV button (not the placeholder)', () => {
      renderSection();
      const card = findCard(/^Accounts$/);
      const btn = within(card).getByRole('button', { name: /^import csv$/i });
      expect(btn).not.toBeDisabled();
      // The disabled "(coming soon)" placeholder must NOT also be present.
      expect(
        within(card).queryByRole('button', { name: /import csv \(coming soon\)/i }),
      ).toBeNull();
    });

    it('Holdings card has a functional Import CSV button', () => {
      renderSection();
      const card = findCard(/^Holdings$/);
      const btn = within(card).getByRole('button', { name: /^import csv$/i });
      expect(btn).not.toBeDisabled();
    });

    it('Properties card has a functional Import CSV button', () => {
      renderSection();
      const card = findCard(/^Properties$/);
      const btn = within(card).getByRole('button', { name: /^import csv$/i });
      expect(btn).not.toBeDisabled();
    });

    it('Vehicles card has a functional Import CSV button', () => {
      renderSection();
      const card = findCard(/^Vehicles$/);
      const btn = within(card).getByRole('button', { name: /^import csv$/i });
      expect(btn).not.toBeDisabled();
    });

    it('Equity grants card has a functional Import CSV button', () => {
      renderSection();
      const card = findCard(/^Equity grants$/i);
      const btn = within(card).getByRole('button', { name: /^import csv$/i });
      expect(btn).not.toBeDisabled();
    });
  });

  it('Wave C C5: holding chips are account-qualified (CW5) — duplicate tickers disambiguate', () => {
    const base = {
      isLoading: false, error: null, load: async () => {}, create: async () => 1,
      update: async () => {}, remove: async () => {},
    };
    useAccountsStore.setState({
      accounts: [{ id: 1, name: 'Taxable Brokerage' }, { id: 2, name: 'Roth IRA' }],
      ...base,
    } as never);
    useHoldingsStore.setState({
      holdings: [
        { id: 10, accountId: 1, ticker: 'VTI' }, { id: 11, accountId: 2, ticker: 'VTI' },
      ],
      ...base,
    } as never);
    render(
      <MemoryRouter>
        <Section2_WhatYouOwn hasData settled status="in_progress" onSetStatus={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('VTI · Taxable Brokerage')).toBeInTheDocument();
    expect(screen.getByText('VTI · Roth IRA')).toBeInTheDocument();
  });

  it('Wave C N7: the Accounts card carries the Manage on Investments link (CW25)', () => {
    render(
      <MemoryRouter>
        <Section2_WhatYouOwn hasData={false} settled status="in_progress" onSetStatus={() => {}} />
      </MemoryRouter>,
    );
    const card = findCard(/^Accounts$/);
    const link = within(card).getByRole('link', { name: 'Manage on Investments page →' });
    expect(link).toHaveAttribute('href', '/investments?manage=accounts');
  });

  it('Wave C C2: saved accounts render the cards even when status is pending', () => {
    useAccountsStore.setState({ accounts: [{ id: 1, name: 'Brokerage' }] } as never);
    render(
      <MemoryRouter>
        <Section2_WhatYouOwn hasData settled status="pending" onSetStatus={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Brokerage')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start this section' })).not.toBeInTheDocument();
  });
});
