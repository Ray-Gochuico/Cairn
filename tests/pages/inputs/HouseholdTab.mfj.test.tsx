import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import HouseholdTab from '@/pages/inputs/HouseholdTab';

/**
 * Smoke D1 (render rung): an MFJ household ROW must render its label on the
 * Inputs form — the smoke read this cell as the ground truth.
 */

describe('HouseholdTab renders a persisted MFJ row (smoke D1)', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    await db.execute("UPDATE household SET filing_status = 'MFJ' WHERE id = 1");
    setDatabase(db);
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('shows Married Filing Jointly in the Filing status select', async () => {
    render(<HouseholdTab />);
    expect(
      await screen.findByText('Married Filing Jointly'),
    ).toBeInTheDocument();
  });
});
