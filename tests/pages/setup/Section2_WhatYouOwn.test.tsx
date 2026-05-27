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
      <Section2_WhatYouOwn status="pending" onSetStatus={() => {}} />,
    );
    expect(screen.getByText(/Your assets/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /start this section/i }),
    ).toBeInTheDocument();
  });

  it('renders the seven cards when status is in_progress', () => {
    render(
      <Section2_WhatYouOwn status="in_progress" onSetStatus={() => {}} />,
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
      <Section2_WhatYouOwn status="pending" onSetStatus={onSetStatus} />,
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
      <Section2_WhatYouOwn status="pending" onSetStatus={onSetStatus} />,
    );
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSetStatus).toHaveBeenCalledWith('skipped');
  });

  describe('Section2_WhatYouOwn — import buttons enabled', () => {
    function renderSection() {
      render(
        <MemoryRouter>
          <Section2_WhatYouOwn status="in_progress" onSetStatus={() => {}} />
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
});
