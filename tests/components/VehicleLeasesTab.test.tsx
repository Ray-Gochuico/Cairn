import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { usePersonsStore } from '@/stores/persons-store';
import VehicleLeasesTab from '@/pages/inputs/VehicleLeasesTab';

describe('VehicleLeasesTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    // loadAllMigrations() instead of a hand-curated subset (see N3 in
    // docs/reviews/2026-05-27-testing-rereview.md).
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useVehicleLeasesStore.setState({
      vehicleLeases: [],
      isLoading: false,
      error: null,
    });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('shows empty state initially', async () => {
    render(
      <MemoryRouter>
        <VehicleLeasesTab />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(/No vehicle leases added yet/i),
    ).toBeInTheDocument();
  });

  it('creates a lease and shows it in the list', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <VehicleLeasesTab />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: /Add Lease/i }));
    await user.type(screen.getByLabelText(/Label/i), 'Tesla Model 3');
    await user.clear(screen.getByLabelText(/Monthly amount/i));
    await user.type(screen.getByLabelText(/Monthly amount/i), '599');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Tesla Model 3')).toBeInTheDocument();
    expect(screen.getByText(/\$599/)).toBeInTheDocument();
  });
});
