import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { usePersonsStore } from '@/stores/persons-store';
import HousingPaymentsTab from '@/pages/inputs/HousingPaymentsTab';

describe('HousingPaymentsTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    // loadAllMigrations() instead of a hand-curated subset so future
    // migration additions don't silently break this file (see
    // docs/reviews/2026-05-27-testing-rereview.md finding N3).
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useHousingPaymentsStore.setState({
      housingPayments: [],
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
        <HousingPaymentsTab />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(/No rent\/housing payments added yet/i),
    ).toBeInTheDocument();
  });

  it('creates a rental and shows it in the list', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <HousingPaymentsTab />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole('button', { name: /Add Rent\/Housing Payment/i }),
    );
    await user.type(screen.getByLabelText(/Label/i), 'Apt rent');
    await user.clear(screen.getByLabelText(/Monthly amount/i));
    await user.type(screen.getByLabelText(/Monthly amount/i), '2400');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Apt rent')).toBeInTheDocument();
    expect(screen.getByText(/\$2,400/)).toBeInTheDocument();
  });
});
