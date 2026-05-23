import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { SettingsRepo } from '@/domain/app-settings';
import { useSettingsStore } from '@/stores/settings-store';
import { SidebarSection } from '@/components/settings/SidebarSection';

describe('SidebarSection', () => {
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

  it('lists every default sidebar tab', async () => {
    render(<MemoryRouter><SidebarSection /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
    for (const label of ['Net Worth', 'Budget', 'Investments', 'Spending', 'Inputs', 'Settings']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('hiding a tab writes a hidden overlay entry for it', async () => {
    render(<MemoryRouter><SidebarSection /></MemoryRouter>);
    const user = userEvent.setup();
    const hideButton = await screen.findByRole('button', { name: /hide net worth/i });
    await user.click(hideButton);

    await waitFor(async () => {
      const settings = await new SettingsRepo(db).get();
      const entry = settings.sidebarLayout?.find((e) => e.to === '/net-worth');
      expect(entry?.hidden).toBe(true);
    });
  });

  it('the Settings tab hide toggle is disabled', async () => {
    render(<MemoryRouter><SidebarSection /></MemoryRouter>);
    const settingsToggle = await screen.findByRole('button', { name: /hide settings/i });
    expect(settingsToggle).toBeDisabled();
  });

  it('moving a tab down reorders it within its section in the stored overlay', async () => {
    render(<MemoryRouter><SidebarSection /></MemoryRouter>);
    const user = userEvent.setup();
    // Dashboard is first in Overview — move it down past Net Worth.
    const moveDown = await screen.findByRole('button', { name: /move dashboard down/i });
    await user.click(moveDown);

    await waitFor(async () => {
      const settings = await new SettingsRepo(db).get();
      const order = (settings.sidebarLayout ?? [])
        .filter((e) => ['/', '/net-worth', '/budget'].includes(e.to))
        .map((e) => e.to);
      // Net Worth now precedes Dashboard within the Overview group.
      expect(order.indexOf('/net-worth')).toBeLessThan(order.indexOf('/'));
    });
  });
});
