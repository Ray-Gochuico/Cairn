import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { SettingsRepo } from '@/domain/app-settings';
import { useSettingsStore } from '@/stores/settings-store';
import { StatementsSection } from '@/components/settings/StatementsSection';

describe('StatementsSection', () => {
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

  it('shows a "no folder" hint when statementsFolderPath is null', async () => {
    render(<MemoryRouter><StatementsSection /></MemoryRouter>);
    expect(
      await screen.findByText(/no folder selected/i),
    ).toBeInTheDocument();
    // With no folder, there is nothing to clear.
    expect(screen.queryByRole('button', { name: /^clear$/i })).toBeNull();
  });

  it('shows the configured folder path', async () => {
    await new SettingsRepo(db).update({ statementsFolderPath: '/Users/me/Statements' });
    render(<MemoryRouter><StatementsSection /></MemoryRouter>);
    expect(await screen.findByText('/Users/me/Statements')).toBeInTheDocument();
  });

  it('Clear removes the configured folder', async () => {
    await new SettingsRepo(db).update({ statementsFolderPath: '/Users/me/Statements' });
    render(<MemoryRouter><StatementsSection /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^clear$/i }));
    expect(await screen.findByText(/no folder selected/i)).toBeInTheDocument();
    expect((await new SettingsRepo(db).get()).statementsFolderPath).toBeNull();
  });
});
