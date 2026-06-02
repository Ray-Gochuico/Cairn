import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import Settings from '@/pages/Settings';

// The DB is set up so that later slices (which make the real sections load
// stores in useEffect) keep this test green without modification.
describe('Settings page', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders the six section cards', () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    for (const title of ['Sidebar', 'Notifications', 'Market data', 'Data', 'Chart colors', 'Statements']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  // L1.3 — the difficulty toggle is retired end-to-end. The 4-set is a fixed
  // 2 Beginner + 2 Advanced (D5), so the per-question difficulty PREFERENCE no
  // longer has a job. Settings no longer mounts the Learning card / its toggle.
  it('has no Learning difficulty toggle (retired with the 4-set)', () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Mixed' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Learning' })).toBeNull();
  });
});
