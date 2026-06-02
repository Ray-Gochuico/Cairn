import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '@/components/layout/Sidebar';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { SettingsRepo } from '@/domain/app-settings';
import { useSettingsStore } from '@/stores/settings-store';

describe('Sidebar', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('hides a tab whose stored layout entry is hidden', async () => {
    await new SettingsRepo(db).update({
      sidebarLayout: [{ to: '/net-worth', hidden: true }],
    });
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    // The overlay loads asynchronously; once applied, Net Worth is gone
    // while a tab absent from the overlay (Dashboard) is still shown.
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /net worth/i })).toBeNull();
    });
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('renders all default tabs when no layout is stored', async () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /net worth/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /spending/i })).toBeInTheDocument();
  });

  it('has a Budget link pointing at /budget', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /budget/i });
    expect(link).toHaveAttribute('href', '/budget');
  });

  it('has a Settings link pointing at /settings and no Profile link', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /settings/i });
    expect(link).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('link', { name: /^profile$/i })).toBeNull();
  });

  it('no longer renders a Backup & Restore link', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    expect(
      screen.queryByRole('link', { name: /backup.*restore/i }),
    ).toBeNull();
  });

  it('has a Backtest link in Planning pointing at /calculators/backtest', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /^backtest$/i });
    expect(link).toHaveAttribute('href', '/calculators/backtest');
  });
});
