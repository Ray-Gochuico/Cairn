import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { SettingsRepo } from '@/domain/app-settings';
import { useSettingsStore } from '@/stores/settings-store';
import { vi } from 'vitest';
import { runMarketDataRefresh } from '@/market/run-market-data-refresh';
import { RefreshSection } from '@/components/settings/RefreshSection';

// Round-3 E5: 'Last refreshed' stamps only AFTER an awaited successful
// refresh — mock the refresh so tests can drive success/failure.
vi.mock('@/market/run-market-data-refresh', () => ({
  runMarketDataRefresh: vi.fn(),
}));
const mRefresh = runMarketDataRefresh as unknown as ReturnType<typeof vi.fn>;

/** A clean W19 aggregate result — all three branches ok, nothing partial. */
function cleanResult(overrides: Partial<{
  snapshot: unknown; fundSync: unknown; enrichment: unknown;
}> = {}) {
  return {
    fundSync: { status: 'ok', result: { refreshed: [], skipped: [], errors: [] } },
    enrichment: { status: 'ok', result: { enriched: 0 } },
    snapshot: {
      status: 'ok',
      result: { upserted: [1], skipped: [], partial: [], errors: [] },
    },
    ...overrides,
  };
}

describe('RefreshSection', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    mRefresh.mockReset();
    mRefresh.mockResolvedValue(cleanResult());
  });

  afterEach(async () => {
    await db.close();
  });

  it('prefills the cadence picker from the stored settings', async () => {
    await new SettingsRepo(db).update({ refreshCadence: 'WEEKLY' });
    render(<MemoryRouter><RefreshSection /></MemoryRouter>);
    const picker = await screen.findByLabelText(/refresh frequency/i);
    expect(picker).toHaveValue('WEEKLY');
  });

  it('changing the cadence persists refreshCadence', async () => {
    render(<MemoryRouter><RefreshSection /></MemoryRouter>);
    const user = userEvent.setup();
    const picker = await screen.findByLabelText(/refresh frequency/i);
    await user.selectOptions(picker, 'MANUAL');

    await waitFor(async () => {
      const settings = await new SettingsRepo(db).get();
      expect(settings.refreshCadence).toBe('MANUAL');
    });
  });

  it('shows "never" when there is no last-refresh timestamp', async () => {
    render(<MemoryRouter><RefreshSection /></MemoryRouter>);
    expect(await screen.findByText(/last refreshed:/i)).toHaveTextContent(/never/i);
  });

  it('clicking "Refresh now" stamps last_refresh_at', async () => {
    render(<MemoryRouter><RefreshSection /></MemoryRouter>);
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: /refresh now/i });
    await user.click(button);

    await waitFor(async () => {
      const settings = await new SettingsRepo(db).get();
      expect(settings.lastRefreshAt).not.toBeNull();
    });
  });

  it('does not stamp Last refreshed when the refresh fails (round-3 E5)', async () => {
    mRefresh.mockRejectedValueOnce(new Error('quota exceeded'));
    render(<MemoryRouter><RefreshSection /></MemoryRouter>);
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: /refresh now/i });
    await user.click(button);

    // Failure surfaces; the stamp never lands (a failed refresh must not
    // read as fresh).
    expect(await screen.findByText(/quota exceeded|refresh failed/i)).toBeInTheDocument();
    const settings = await new SettingsRepo(db).get();
    expect(settings.lastRefreshAt).toBeNull();
    expect(screen.getByText(/last refreshed:/i)).toHaveTextContent(/never/i);
  });

  it('W19: genuinely awaits — button reads Refreshing… until the refresh settles', async () => {
    let resolveRefresh!: (r: unknown) => void;
    mRefresh.mockImplementationOnce(
      () => new Promise((r) => { resolveRefresh = r; }),
    );
    render(<MemoryRouter><RefreshSection /></MemoryRouter>);
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: /refresh now/i });
    await user.click(button);

    // In flight: real network time now, not a next-microtask no-op.
    expect(screen.getByRole('button', { name: /refreshing…/i })).toBeDisabled();
    const before = await new SettingsRepo(db).get();
    expect(before.lastRefreshAt).toBeNull();

    resolveRefresh(cleanResult());
    await waitFor(async () => {
      expect(screen.getByRole('button', { name: /refresh now/i })).toBeEnabled();
      const settings = await new SettingsRepo(db).get();
      expect(settings.lastRefreshAt).not.toBeNull();
    });
  });

  it('W19: surfaces unpriceable tickers from a partial snapshot AND still stamps', async () => {
    // Policy pinned here: a partial refresh is a COMPLETED attempt (some
    // accounts priced, the held-back ones are named), so the stamp lands
    // and the detail is surfaced honestly.
    mRefresh.mockResolvedValueOnce(cleanResult({
      snapshot: {
        status: 'ok',
        result: {
          upserted: [1],
          skipped: [],
          partial: [7],
          errors: ['7/XYZ: No quote data for XYZ'],
        },
      },
    }));
    render(<MemoryRouter><RefreshSection /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /refresh now/i }));

    const warning = await screen.findByText(/couldn't price XYZ/i);
    expect(warning).toHaveTextContent(/left unchanged/i);
    const settings = await new SettingsRepo(db).get();
    expect(settings.lastRefreshAt).not.toBeNull();
  });

  it('W19: a snapshot-branch failure surfaces as a failed refresh and does NOT stamp', async () => {
    // Policy pinned here: if pricing could not run at all, nothing about
    // account values is fresher than before — stamping would lie to the
    // freshness badge (round-3 E5 extended to network failures).
    mRefresh.mockResolvedValueOnce(cleanResult({
      snapshot: { status: 'error', error: 'Yahoo unreachable' },
    }));
    render(<MemoryRouter><RefreshSection /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /refresh now/i }));

    expect(await screen.findByText(/yahoo unreachable/i)).toBeInTheDocument();
    const settings = await new SettingsRepo(db).get();
    expect(settings.lastRefreshAt).toBeNull();
    expect(screen.getByText(/last refreshed:/i)).toHaveTextContent(/never/i);
  });
});
