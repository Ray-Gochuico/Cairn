import { describe, it, expect, beforeEach, vi } from 'vitest';

// TransactionsSectionImporter pulls in the PDF extract + parse pipeline,
// neither of which works in jsdom. Mock both at the module level so
// Section 4 can render the importer without booting pdfjs.
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn().mockReturnValue({
    issuer: 'GENERIC',
    transactions: [],
  }),
}));
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn().mockResolvedValue(null),
  resolveArchivePath: vi.fn(),
}));

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAccountsStore } from '@/stores/accounts-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useGoalsStore } from '@/stores/goals-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import Section4_History from '@/pages/setup/Section4_History';

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
  useSnapshotsStore.setState({
    snapshots: [],
    ...base,
    upsert: async () => 1,
    refresh: async () => {},
  } as any);
  useContributionsStore.setState({ contributions: [], ...base } as any);
  useAssetValueSnapshotsStore.setState({
    assetValueSnapshots: [],
    ...base,
    removeForOwner: async () => {},
  } as any);
  usePropertiesStore.setState({ properties: [], ...base } as any);
  useVehiclesStore.setState({ vehicles: [], ...base } as any);
  useGoalsStore.setState({ goals: [], ...base } as any);
  usePersonsStore.setState({
    persons: [{ id: 1, name: 'Alice' }],
    ...base,
  } as any);
  // ImportCsvButton subscribes to these stores for ValidationContext.
  useCategoriesStore.setState({ categories: [], ...base } as any);
  useTransactionsStore.setState({ transactions: [], ...base } as any);
  useHoldingsStore.setState({ holdings: [], ...base } as any);
  useLoansStore.setState({ loans: [], ...base } as any);
  useEquityGrantsStore.setState({ equityGrants: [], ...base } as any);
}

function findCard(title: RegExp): HTMLElement {
  const heading = screen.getByText(title);
  const card = heading.closest('div[class*="rounded"]');
  if (!card) throw new Error(`Card not found for ${title}`);
  return card as HTMLElement;
}

function renderWithRouter(initialEntries: string[] = ['/setup']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route
          path="/setup"
          element={
            <Section4_History hasData={false} settled status="in_progress" onSetStatus={() => {}} />
          }
        />
        <Route path="/spending" element={<div>Spending page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Section4_History', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the entry gate when status is pending', () => {
    render(
      <MemoryRouter>
        <Section4_History hasData={false} settled status="pending" onSetStatus={() => {}} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Your history and goals/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /start this section/i }),
    ).toBeInTheDocument();
  });

  it('renders the five cards when status is in_progress', () => {
    renderWithRouter();
    expect(screen.getByText(/Account snapshots/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Property \/ vehicle values/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Contributions$/)).toBeInTheDocument();
    expect(screen.getByText(/^Transactions$/)).toBeInTheDocument();
    expect(screen.getByText(/^Goals$/)).toBeInTheDocument();
  });

  it('Transactions card embeds the unified PDF/CSV drop zone', () => {
    renderWithRouter();
    const card = findCard(/^Transactions$/);
    expect(
      within(card).getByText(/drop pdfs or csvs here/i),
    ).toBeInTheDocument();
  });

  it('Transactions card exposes a "Manage on Spending page" link to /spending', () => {
    renderWithRouter();
    const card = findCard(/^Transactions$/);
    const link = within(card).getByRole('link', {
      name: /manage on spending page/i,
    });
    expect(link).toHaveAttribute('href', '/spending');
  });

  it('clicking Skip flips status to skipped', async () => {
    const user = userEvent.setup();
    const onSetStatus = vi.fn();
    render(
      <MemoryRouter>
        <Section4_History hasData={false} settled status="pending" onSetStatus={onSetStatus} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSetStatus).toHaveBeenCalledWith('skipped');
  });

  describe('created-entity chips', () => {
    it('renders each added goal as a named chip on the Goals card', () => {
      useGoalsStore.setState((s: any) => ({
        ...s,
        goals: [
          { id: 1, name: 'House fund' },
          { id: 2, name: 'Retire at 55' },
        ],
      }));
      renderWithRouter();
      const chips = screen.getByTestId('goals-chips');
      expect(within(chips).getByText('House fund')).toBeInTheDocument();
      expect(within(chips).getByText('Retire at 55')).toBeInTheDocument();
    });

    it('keeps snapshots and contributions count-only (no chip containers)', () => {
      useSnapshotsStore.setState((s: any) => ({
        ...s,
        snapshots: [{ id: 1, accountId: 1, snapshotDate: '2026-01-01', totalValue: 100 }],
      }));
      useContributionsStore.setState((s: any) => ({
        ...s,
        contributions: [{ id: 1, accountId: 1, date: '2026-01-01', amount: 50 }],
      }));
      renderWithRouter();
      expect(screen.queryByTestId('account-snapshots-chips')).toBeNull();
      expect(screen.queryByTestId('contributions-chips')).toBeNull();
    });
  });

  describe('Section4_History — non-transactions cards', () => {
    beforeEach(() => {
      // Account snapshots + contributions imports are gated until at least
      // one account exists (W7). Seed one account so they render enabled.
      useAccountsStore.setState((s: any) => ({ ...s, accounts: [{ id: 1, name: 'Test Account' }] }));
    });

    it('Account snapshots card has a functional Import CSV button', () => {
      renderWithRouter();
      const card = findCard(/Account snapshots/);
      const btn = within(card).getByRole('button', { name: /^import csv$/i });
      expect(btn).not.toBeDisabled();
    });

    it('Contributions card has a functional Import CSV button', () => {
      renderWithRouter();
      const card = findCard(/^Contributions$/);
      const btn = within(card).getByRole('button', { name: /^import csv$/i });
      expect(btn).not.toBeDisabled();
    });

    it('Property / vehicle values card keeps the disabled placeholder (uses ValueHistorySection)', () => {
      renderWithRouter();
      const card = findCard(/Property \/ vehicle values/);
      const btn = within(card).getByRole('button', { name: /^import csv$/i });
      expect(btn).toBeDisabled();
      // Softened from "(coming soon)" — no importer is planned for this entity.
      expect(within(card).queryByText(/coming soon/i)).toBeNull();
    });

    it('Goals card keeps the disabled placeholder', () => {
      renderWithRouter();
      const card = findCard(/^Goals$/);
      const btn = within(card).getByRole('button', { name: /^import csv$/i });
      expect(btn).toBeDisabled();
      expect(within(card).queryByText(/coming soon/i)).toBeNull();
    });
  });

  it('Wave C C5/DC7: count-only cards get qualified counts (CW6-CW8), never chip floods', () => {
    useSnapshotsStore.setState((s: any) => ({
      ...s,
      snapshots: [
        { id: 1, accountId: 1, snapshotDate: '2026-05-31', totalValue: 1, source: 'MANUAL' },
        { id: 2, accountId: 2, snapshotDate: '2026-06-30', totalValue: 1, source: 'MANUAL' },
      ],
    }));
    renderWithRouter();
    expect(screen.getByText('2 snapshots across 2 accounts · latest Jun 2026')).toBeInTheDocument();
  });

  it('Wave C C2: saved history renders the cards even when status is pending', () => {
    useGoalsStore.setState((s: any) => ({
      ...s,
      goals: [{ id: 1, name: 'House fund' }],
    }));
    render(
      <MemoryRouter>
        <Section4_History hasData settled status="pending" onSetStatus={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Account snapshots')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start this section' })).not.toBeInTheDocument();
  });
});
