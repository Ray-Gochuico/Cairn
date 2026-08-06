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
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import Section3_WhatYouOwe from '@/pages/setup/Section3_WhatYouOwe';

function resetStores() {
  const base = {
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  };
  useLoansStore.setState({ loans: [], ...base } as any);
  usePersonsStore.setState({
    persons: [{ id: 1, name: 'Alice' }],
    ...base,
  } as any);
  usePropertiesStore.setState({ properties: [], ...base } as any);
  useVehiclesStore.setState({ vehicles: [], ...base } as any);
  // ImportCsvButton subscribes to these stores for ValidationContext.
  useAccountsStore.setState({ accounts: [], ...base } as any);
  useCategoriesStore.setState({ categories: [], ...base } as any);
  useSnapshotsStore.setState({
    snapshots: [],
    ...base,
    upsert: async () => 1,
    refresh: async () => {},
  } as any);
  useTransactionsStore.setState({ transactions: [], ...base } as any);
  useHoldingsStore.setState({ holdings: [], ...base } as any);
  useEquityGrantsStore.setState({ equityGrants: [], ...base } as any);
  useContributionsStore.setState({ contributions: [], ...base } as any);
  useAssetValueSnapshotsStore.setState({
    assetValueSnapshots: [],
    ...base,
    removeForOwner: async () => {},
  } as any);
}

function findCard(title: RegExp): HTMLElement {
  const heading = screen.getByText(title);
  const card = heading.closest('div[class*="rounded"]');
  if (!card) throw new Error(`Card not found for ${title}`);
  return card as HTMLElement;
}

describe('Section3_WhatYouOwe', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the entry gate when status is pending', () => {
    render(
      <Section3_WhatYouOwe hasData={false} settled status="pending" onSetStatus={() => {}} />,
    );
    expect(screen.getByText(/Your debts/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /start this section/i }),
    ).toBeInTheDocument();
  });

  it('renders the Loans card when status is in_progress', () => {
    render(
      <Section3_WhatYouOwe hasData={false} settled status="in_progress" onSetStatus={() => {}} />,
    );
    expect(screen.getByText(/^Loans$/)).toBeInTheDocument();
  });

  it('clicking Skip flips status to skipped', async () => {
    const user = userEvent.setup();
    const onSetStatus = vi.fn();
    render(
      <Section3_WhatYouOwe hasData={false} settled status="pending" onSetStatus={onSetStatus} />,
    );
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSetStatus).toHaveBeenCalledWith('skipped');
  });

  it('clicking Add manually on the Loans card opens the LoanForm dialog', async () => {
    const user = userEvent.setup();
    render(
      <Section3_WhatYouOwe hasData={false} settled status="in_progress" onSetStatus={() => {}} />,
    );
    await user.click(
      screen.getByRole('button', { name: /add manually/i }),
    );
    expect(
      await screen.findByRole('button', { name: /add loan/i }),
    ).toBeInTheDocument();
  });

  it('Loans card has a functional Import CSV button (not the placeholder)', () => {
    render(
      <MemoryRouter>
        <Section3_WhatYouOwe hasData={false} settled status="in_progress" onSetStatus={() => {}} />
      </MemoryRouter>,
    );
    const card = findCard(/^Loans$/);
    const btn = within(card).getByRole('button', { name: /^import csv$/i });
    expect(btn).not.toBeDisabled();
    expect(
      within(card).queryByRole('button', {
        name: /import csv \(coming soon\)/i,
      }),
    ).toBeNull();
  });

  it('renders each added loan as a named chip on the Loans card', () => {
    useLoansStore.setState((s: any) => ({
      ...s,
      loans: [
        { id: 1, name: 'Mortgage' },
        { id: 2, name: 'Car loan' },
      ],
    }));
    render(
      <MemoryRouter>
        <Section3_WhatYouOwe hasData={false} settled status="in_progress" onSetStatus={() => {}} />
      </MemoryRouter>,
    );
    const chips = screen.getByTestId('loans-chips');
    expect(within(chips).getByText('Mortgage')).toBeInTheDocument();
    expect(within(chips).getByText('Car loan')).toBeInTheDocument();
  });

  it('renders no loans chip container when no loans exist', () => {
    render(
      <MemoryRouter>
        <Section3_WhatYouOwe hasData={false} settled status="in_progress" onSetStatus={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('loans-chips')).toBeNull();
  });

  it('shows the calm intro banner once the section is in progress', () => {
    render(
      <MemoryRouter>
        <Section3_WhatYouOwe hasData={false} settled status="in_progress" onSetStatus={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('section3-intro')).toBeInTheDocument();
    // SINGLE stable word (must-fix W6): one durable anchor ("skip"), not a
    // multi-word set — kept identical to sections.test.ts so a copy tweak
    // does not break both tests. If final copy drops "skip", update both.
    expect(screen.getByTestId('section3-intro').textContent).toMatch(/skip/i);
  });

  it('does not show the in-progress banner on the pre-start gate', () => {
    render(
      <Section3_WhatYouOwe hasData={false} settled status="pending" onSetStatus={() => {}} />,
    );
    // The SectionEntryGate is shown instead; the in-progress banner is absent.
    expect(screen.queryByTestId('section3-intro')).toBeNull();
  });

  it('Wave C C2: saved loans render the cards even when status is pending', () => {
    useLoansStore.setState({
      loans: [{ id: 1, name: 'Mortgage' }],
      isLoading: false, error: null, load: async () => {}, create: async () => 1,
      update: async () => {}, remove: async () => {},
    } as never);
    render(
      <Section3_WhatYouOwe hasData settled status="pending" onSetStatus={() => {}} />,
    );
    expect(screen.getByText('Mortgage')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start this section' })).not.toBeInTheDocument();
  });
});
