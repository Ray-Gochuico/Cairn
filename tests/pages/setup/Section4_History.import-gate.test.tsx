import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Section4_History from '@/pages/setup/Section4_History';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useGoalsStore } from '@/stores/goals-store';
import { useTransactionsStore } from '@/stores/transactions-store';

vi.mock('@/components/import/ImportCsvButton', () => ({
  ImportCsvButton: () => <button type="button">Import CSV</button>,
}));
// TransactionsSectionImporter and ValueHistorySection also pull stores;
// stub them to keep this test scoped to the account-gate behavior.
vi.mock('@/components/setup/TransactionsSectionImporter', () => ({
  default: () => <div data-testid="tx-importer-stub" />,
}));
vi.mock('@/components/inputs/ValueHistorySection', () => ({
  default: () => <div data-testid="value-history-stub" />,
}));

const base = {
  isLoading: false,
  error: null,
  load: async () => {},
  create: async () => 1,
  update: async () => {},
  remove: async () => {},
};

function seedStores(accountCount: number) {
  const accounts = Array.from({ length: accountCount }, (_, i) => ({
    id: i + 1,
    name: `Acct ${i + 1}`,
  }));
  useAccountsStore.setState({ accounts, ...base } as never);
  useSnapshotsStore.setState({ snapshots: [], ...base, upsert: async () => 1, refresh: async () => {} } as never);
  useContributionsStore.setState({ contributions: [], ...base } as never);
  useAssetValueSnapshotsStore.setState({
    assetValueSnapshots: [],
    ...base,
    removeForOwner: async () => {},
  } as never);
  usePropertiesStore.setState({ properties: [], ...base } as never);
  useVehiclesStore.setState({ vehicles: [], ...base } as never);
  useGoalsStore.setState({ goals: [], ...base } as never);
  useTransactionsStore.setState({ transactions: [], ...base } as never);
}

function renderSection() {
  return render(
    <MemoryRouter>
      <Section4_History status="in_progress" onSetStatus={() => {}} />
    </MemoryRouter>,
  );
}

describe('Section4_History import gating (W7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables snapshot + contribution imports with a reason when there are no accounts', () => {
    seedStores(0);
    renderSection();
    // The shared reason appears (once per gated card → at least one match).
    const notes = screen.getAllByText(/imports match rows to existing accounts by name/i);
    expect(notes.length).toBeGreaterThanOrEqual(2); // snapshots + contributions
    // The disabled placeholder buttons are present and disabled.
    const importButtons = screen.getAllByRole('button', { name: /^import csv$/i });
    for (const btn of importButtons) {
      expect(btn).toBeDisabled();
    }
  });

  it('renders the live import trigger (no reason) once an account exists', () => {
    seedStores(1);
    renderSection();
    expect(
      screen.queryByText(/imports match rows to existing accounts by name/i),
    ).toBeNull();
    // The stubbed ImportCsvButton renders an enabled "Import CSV" button.
    const importButtons = screen.getAllByRole('button', { name: /^import csv$/i });
    expect(importButtons.length).toBeGreaterThanOrEqual(2);
    for (const btn of importButtons) {
      expect(btn).not.toBeDisabled();
    }
  });
});
