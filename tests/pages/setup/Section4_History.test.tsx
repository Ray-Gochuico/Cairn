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
            <Section4_History status="in_progress" onSetStatus={() => {}} />
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
        <Section4_History status="pending" onSetStatus={() => {}} />
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
        <Section4_History status="pending" onSetStatus={onSetStatus} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSetStatus).toHaveBeenCalledWith('skipped');
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
      const btn = within(card).getByRole('button', {
        name: /import csv \(coming soon\)/i,
      });
      expect(btn).toBeDisabled();
    });

    it('Goals card keeps the disabled placeholder', () => {
      renderWithRouter();
      const card = findCard(/^Goals$/);
      const btn = within(card).getByRole('button', {
        name: /import csv \(coming soon\)/i,
      });
      expect(btn).toBeDisabled();
    });
  });
});
