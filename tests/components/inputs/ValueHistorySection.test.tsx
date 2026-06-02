import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { setDatabase } from '@/db/db';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import ValueHistorySection from '@/components/inputs/ValueHistorySection';

function renderSection(props: {
  ownerType: 'PROPERTY' | 'VEHICLE';
  ownerId: number;
  fallbackValue: number | null;
}) {
  return render(
    <MemoryRouter>
      <ValueHistorySection {...props} />
    </MemoryRouter>,
  );
}

describe('ValueHistorySection', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useAssetValueSnapshotsStore.setState({
      assetValueSnapshots: [],
      isLoading: false,
      error: null,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders empty-state copy when no snapshots exist', async () => {
    renderSection({ ownerType: 'PROPERTY', ownerId: 1, fallbackValue: 400000 });
    // Component triggers load() on mount — empty state still appears immediately
    // because there's nothing in the store.
    expect(
      await screen.findByText(/Using current estimated value/i),
    ).toBeInTheDocument();
    // Fallback amount is mentioned
    expect(screen.getByText(/\$400,000/)).toBeInTheDocument();
  });

  it('renders the entry count in the summary', () => {
    renderSection({ ownerType: 'PROPERTY', ownerId: 1, fallbackValue: 400000 });
    expect(
      screen.getByText(/Value history \(0\)/i),
    ).toBeInTheDocument();
  });

  it('lets the user add a dated entry', async () => {
    const user = userEvent.setup();
    renderSection({ ownerType: 'PROPERTY', ownerId: 1, fallbackValue: 400000 });

    await user.type(screen.getByLabelText(/date/i), '2026-04-01');
    await user.type(screen.getByLabelText(/value/i), '410000');
    await user.click(screen.getByRole('button', { name: /add entry/i }));

    // Newly added row shows the formatted value
    expect(await screen.findByText(/\$410,000/)).toBeInTheDocument();
    expect(screen.getByText('2026-04-01')).toBeInTheDocument();
  });

  it('filters out entries that belong to a different owner', async () => {
    const user = userEvent.setup();
    // Seed via store: one entry for ownerId 1, one for ownerId 2
    await useAssetValueSnapshotsStore.getState().create({
      ownerType: 'PROPERTY',
      ownerId: 1,
      snapshotDate: '2026-04-01',
      value: 410000,
    });
    await useAssetValueSnapshotsStore.getState().create({
      ownerType: 'PROPERTY',
      ownerId: 2,
      snapshotDate: '2026-04-01',
      value: 999999,
    });

    renderSection({ ownerType: 'PROPERTY', ownerId: 1, fallbackValue: null });

    expect(await screen.findByText(/\$410,000/)).toBeInTheDocument();
    expect(screen.queryByText(/\$999,999/)).not.toBeInTheDocument();
    // Only one entry in the list — summary shows (1)
    expect(screen.getByText(/Value history \(1\)/i)).toBeInTheDocument();

    void user;
  });

  it('lets the user delete an entry', async () => {
    const user = userEvent.setup();
    await useAssetValueSnapshotsStore.getState().create({
      ownerType: 'VEHICLE',
      ownerId: 5,
      snapshotDate: '2026-02-01',
      value: 22000,
    });

    renderSection({ ownerType: 'VEHICLE', ownerId: 5, fallbackValue: 25000 });

    expect(await screen.findByText(/\$22,000/)).toBeInTheDocument();

    const row = screen.getByTestId('value-history-row-5-2026-02-01');
    await user.click(within(row).getByRole('button', { name: /delete/i }));

    // The action is now gated behind the shared ConfirmDialog — the entry
    // is not removed until the user confirms in the dialog.
    expect(
      await screen.findByText(/delete this dated value entry\?/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/\$22,000/)).toBeInTheDocument();

    const confirmDialog = await screen.findByRole('dialog');
    await user.click(within(confirmDialog).getByRole('button', { name: /^delete$/i }));

    // Empty state returns
    expect(
      await screen.findByText(/Using current estimated value/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\$22,000/)).not.toBeInTheDocument();
  });

  it('lets the user edit an entry value', async () => {
    const user = userEvent.setup();
    await useAssetValueSnapshotsStore.getState().create({
      ownerType: 'PROPERTY',
      ownerId: 3,
      snapshotDate: '2026-03-01',
      value: 500000,
    });

    renderSection({ ownerType: 'PROPERTY', ownerId: 3, fallbackValue: null });

    expect(await screen.findByText(/\$500,000/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /edit/i }));

    const editInput = screen.getByLabelText(/edit value/i);
    await user.clear(editInput);
    await user.type(editInput, '525000');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/\$525,000/)).toBeInTheDocument();
    expect(screen.queryByText(/\$500,000/)).not.toBeInTheDocument();
  });

  it('rejects negative values on add via inline error', async () => {
    const user = userEvent.setup();
    renderSection({ ownerType: 'PROPERTY', ownerId: 1, fallbackValue: null });

    await user.type(screen.getByLabelText(/date/i), '2026-04-01');
    await user.type(screen.getByLabelText(/value/i), '-1');
    await user.click(screen.getByRole('button', { name: /add entry/i }));

    expect(await screen.findByText(/non-negative/i)).toBeInTheDocument();
  });

  it('renders an Import CSV button in the section body', () => {
    renderSection({ ownerType: 'PROPERTY', ownerId: 1, fallbackValue: 400000 });
    expect(
      screen.getByRole('button', { name: /import csv/i }),
    ).toBeInTheDocument();
  });

  it('Import CSV button has the hidden file input wired', () => {
    renderSection({ ownerType: 'PROPERTY', ownerId: 1, fallbackValue: 400000 });
    expect(screen.getByTestId('import-csv-file-input')).toBeInTheDocument();
  });
});
