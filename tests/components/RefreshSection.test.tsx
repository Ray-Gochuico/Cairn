import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { SettingsRepo } from '@/domain/app-settings';
import { useSettingsStore } from '@/stores/settings-store';
import { RefreshSection } from '@/components/settings/RefreshSection';

describe('RefreshSection', () => {
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
});
