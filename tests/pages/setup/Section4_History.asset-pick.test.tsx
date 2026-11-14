import { describe, it, expect, beforeEach, vi } from 'vitest';

// Same module mocks as tests/pages/setup/Section4_History.test.tsx: the
// Transactions card's importer pulls in the PDF pipeline, which jsdom cannot run.
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn().mockReturnValue({ issuer: 'GENERIC', transactions: [] }),
}));
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn().mockResolvedValue(null),
  resolveArchivePath: vi.fn(),
}));

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
import { AssetSnapshotOwnerType } from '@/types/enums';
import Section4_History from '@/pages/setup/Section4_History';

const createSnapshot = vi.fn();
const updateSnapshot = vi.fn();

function resetStores(assetValueSnapshots: unknown[] = []) {
  const base = {
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  };
  useAccountsStore.setState({ accounts: [], ...base } as any);
  useSnapshotsStore.setState({ snapshots: [], ...base, upsert: async () => 1, refresh: async () => {} } as any);
  useContributionsStore.setState({ contributions: [], ...base } as any);
  useAssetValueSnapshotsStore.setState({
    assetValueSnapshots,
    ...base,
    create: createSnapshot,
    update: updateSnapshot,
    removeForOwner: async () => {},
  } as any);
  usePropertiesStore.setState({
    properties: [{ id: 1, name: 'Main St house', currentEstimatedValue: 500000 }],
    ...base,
  } as any);
  useVehiclesStore.setState({
    vehicles: [{ id: 2, name: 'Civic', currentEstimatedValue: 20000 }],
    ...base,
  } as any);
  useGoalsStore.setState({ goals: [], ...base } as any);
  usePersonsStore.setState({ persons: [{ id: 1, name: 'Alice' }], ...base } as any);
  useCategoriesStore.setState({ categories: [], ...base } as any);
  useTransactionsStore.setState({ transactions: [], ...base } as any);
  useHoldingsStore.setState({ holdings: [], ...base } as any);
  useLoansStore.setState({ loans: [], ...base } as any);
  useEquityGrantsStore.setState({ equityGrants: [], ...base } as any);
}

async function openAssetValuesDialog(user: ReturnType<typeof userEvent.setup>) {
  render(
    <MemoryRouter>
      <Section4_History hasData={false} settled status="in_progress" onSetStatus={() => {}} />
    </MemoryRouter>,
  );
  const heading = screen.getByText(/Property \/ vehicle values/);
  const card = heading.closest('div[class*="rounded"]') as HTMLElement;
  await user.click(within(card).getByRole('button', { name: /add manually/i }));
  const dialog = await screen.findByRole('dialog');
  const picker = within(dialog).getByLabelText(/property or vehicle/i) as HTMLSelectElement;
  await user.click(within(dialog).getByText(/^Value history \(/));
  return { dialog, picker };
}

describe('v1.8.0 O1 (RC1): the Section 4 "Property / vehicle values" asset pick keeps what was typed', () => {
  beforeEach(() => {
    createSnapshot.mockReset();
    createSnapshot.mockResolvedValue(1);
    updateSnapshot.mockReset();
    updateSnapshot.mockResolvedValue(undefined);
  });

  it('a new asset keeps the typed date and value and the open Value history, and Add entry saves to the asset shown', async () => {
    resetStores();
    const user = userEvent.setup();
    const { dialog, picker } = await openAssetValuesDialog(user);
    expect(picker.value).toBe('PROPERTY-1');
    await user.type(within(dialog).getByLabelText('Value'), '600000');
    await user.type(within(dialog).getByLabelText('Date'), '2025-12-31');
    const value = within(dialog).getByLabelText('Value');

    await user.selectOptions(picker, 'VEHICLE-2');

    expect(picker.value).toBe('VEHICLE-2');
    expect(within(dialog).getByLabelText('Value')).toHaveValue(600000);
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2025-12-31');
    expect(value.isConnected).toBe(true); // the same form, never a fresh one
    expect(dialog.querySelector('details')!.open).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Add entry' }));
    expect(createSnapshot).toHaveBeenCalledTimes(1);
    expect(createSnapshot).toHaveBeenCalledWith({
      ownerType: AssetSnapshotOwnerType.VEHICLE,
      ownerId: 2,
      snapshotDate: '2025-12-31',
      value: 600000,
    });
  });

  it('an edit in progress survives a trip to another asset and back, and Save updates its own entry', async () => {
    resetStores([
      { id: 7, ownerType: AssetSnapshotOwnerType.PROPERTY, ownerId: 1, snapshotDate: '2025-06-30', value: 550000 },
    ]);
    const user = userEvent.setup();
    const { dialog, picker } = await openAssetValuesDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Edit' }));
    const edit = within(dialog).getByLabelText('Edit value');
    await user.clear(edit);
    await user.type(edit, '560000');

    await user.selectOptions(picker, 'VEHICLE-2');
    expect(within(dialog).queryByLabelText('Edit value')).toBeNull(); // the vehicle has no entries
    await user.selectOptions(picker, 'PROPERTY-1');

    expect(within(dialog).getByLabelText('Edit value')).toHaveValue(560000);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(updateSnapshot).toHaveBeenCalledTimes(1);
    expect(updateSnapshot).toHaveBeenCalledWith(7, { value: 560000 });
  });
});
