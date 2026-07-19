import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '@/components/layout/Sidebar';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { SettingsRepo } from '@/domain/app-settings';
import { useSettingsStore } from '@/stores/settings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { AccountType, SnapshotSource } from '@/types/enums';

describe('Sidebar', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    // The pending-dot hook subscribes to these two stores — reset them so
    // dot-test seeds never leak across tests.
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} } as never);
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: async () => {} } as never);
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

  it('renders the primary navigation landmark', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
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

  it('active route carries the 2px blaze left-edge mark, not the filled pill (Wave 12)', () => {
    render(<MemoryRouter initialEntries={['/']}><Sidebar /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /dashboard/i });
    expect(link).toHaveAttribute('aria-current', 'page'); // NavLink built-in — state is not color-only
    expect(link.className).toContain('border-blaze');
    expect(link.className).not.toContain('bg-primary/10');
  });

  it('inactive routes reserve the edge (transparent border — no layout shift on activation)', () => {
    render(<MemoryRouter initialEntries={['/']}><Sidebar /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /settings/i });
    expect(link.className).toContain('border-transparent');
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

  it('Wave 18 C9: the duplicate Backtest entry is retired (ONE backtest path, via Calculators)', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /^backtest$/i })).toBeNull();
    // The Calculators entry (which hosts the Backtest card + route) survives.
    expect(screen.getByRole('link', { name: /^calculators$/i })).toHaveAttribute(
      'href',
      '/calculators',
    );
  });

  it('tags each nav link with a data-tour-id matching its route (tour anchor)', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    const dashboard = screen.getByRole('link', { name: /dashboard/i });
    expect(dashboard).toHaveAttribute('data-tour-id', '/');
    const settings = screen.getByRole('link', { name: /settings/i });
    expect(settings).toHaveAttribute('data-tour-id', '/settings');
  });

  describe('Monthly check-in entry + pending dot', () => {
    const mkAccount = (id: number, type: AccountType) =>
      ({ id, type, excludedFromNetWorth: false, name: `A${id}` }) as never;
    const mkSnap = (accountId: number, date: string, source: SnapshotSource) =>
      ({ id: accountId * 100, accountId, snapshotDate: date, totalValue: 1, source }) as never;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('has a Monthly check-in link pointing at /monthly in the System group', () => {
      render(<MemoryRouter><Sidebar /></MemoryRouter>);
      expect(screen.getByRole('link', { name: /Monthly check-in/ })).toHaveAttribute('href', '/monthly');
    });

    it('shows the pending dot when a derived account lacks last-month confirmation', () => {
      useAccountsStore.setState({
        accounts: [mkAccount(1, AccountType.ACCOUNT_BROKERAGE)],
        isLoading: false, error: null, load: async () => {},
      } as never);
      useSnapshotsStore.setState({
        snapshots: [mkSnap(1, '2026-05-29', SnapshotSource.AUTO_DERIVED)],
        isLoading: false, error: null, load: async () => {},
      } as never);
      render(<MemoryRouter><Sidebar /></MemoryRouter>);
      expect(screen.getByText(/monthly input pending/i)).toBeInTheDocument(); // sr-only text
    });

    it('no dot when last month is confirmed', () => {
      useAccountsStore.setState({
        accounts: [mkAccount(1, AccountType.ACCOUNT_BROKERAGE)],
        isLoading: false, error: null, load: async () => {},
      } as never);
      useSnapshotsStore.setState({
        snapshots: [mkSnap(1, '2026-05-29', SnapshotSource.USER_CONFIRMED)],
        isLoading: false, error: null, load: async () => {},
      } as never);
      render(<MemoryRouter><Sidebar /></MemoryRouter>);
      expect(screen.queryByText(/monthly input pending/i)).not.toBeInTheDocument();
    });
  });
});

describe('INPUTS → SETUP (W14)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: null, isLoading: false, error: null, load: async () => {} } as never);
  });

  it('System order is Monthly check-in → Setup (/inputs) → Settings; no "Inputs" label anywhere', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    const setup = screen.getByRole('link', { name: /^setup$/i });
    expect(setup).toHaveAttribute('href', '/inputs'); // route key kept (decision #6)
    expect(screen.queryByRole('link', { name: /^inputs$/i })).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const hrefs = Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    const monthlyIdx = hrefs.indexOf('/monthly');
    expect(monthlyIdx).toBeGreaterThan(-1);
    expect(hrefs.slice(monthlyIdx)).toEqual(['/monthly', '/inputs', '/settings']);
  });
});
