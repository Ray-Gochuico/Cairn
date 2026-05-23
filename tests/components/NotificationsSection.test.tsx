import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { SettingsRepo } from '@/domain/app-settings';
import { useSettingsStore } from '@/stores/settings-store';
import { NotificationsSection } from '@/components/settings/NotificationsSection';

describe('NotificationsSection', () => {
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

  it('prefills the toggle and day from the stored settings', async () => {
    await new SettingsRepo(db).update({ notificationsEnabled: true, notificationDay: 1 });
    render(<MemoryRouter><NotificationsSection /></MemoryRouter>);
    const toggle = await screen.findByLabelText(/monthly check-in reminder/i);
    expect(toggle).toBeChecked();
    expect(screen.getByLabelText(/day of month/i)).toHaveValue('1');
  });

  it('toggling the reminder off persists notificationsEnabled = false', async () => {
    render(<MemoryRouter><NotificationsSection /></MemoryRouter>);
    const user = userEvent.setup();
    const toggle = await screen.findByLabelText(/monthly check-in reminder/i);
    await user.click(toggle);

    await waitFor(async () => {
      const settings = await new SettingsRepo(db).get();
      expect(settings.notificationsEnabled).toBe(false);
    });
  });

  it('picking a day persists notificationDay', async () => {
    render(<MemoryRouter><NotificationsSection /></MemoryRouter>);
    const user = userEvent.setup();
    const dayPicker = await screen.findByLabelText(/day of month/i);
    await user.selectOptions(dayPicker, '15');

    await waitFor(async () => {
      const settings = await new SettingsRepo(db).get();
      expect(settings.notificationDay).toBe(15);
    });
  });

  it('offers exactly the days 1 through 28', async () => {
    render(<MemoryRouter><NotificationsSection /></MemoryRouter>);
    const dayPicker = await screen.findByLabelText(/day of month/i);
    const values = Array.from(
      (dayPicker as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(values).toEqual(
      Array.from({ length: 28 }, (_, i) => String(i + 1)),
    );
  });
});
