import type { Database } from '@/db/db';
import { AppSettingsSchema, type AppSettings, type SidebarLayoutEntry } from '@/types/schema';

interface AppSettingsRow {
  id: number;
  sidebar_layout: string | null;
  notifications_enabled: number;
  notification_day: number;
  refresh_cadence: string;
  last_refresh_at: string | null;
  statements_folder_path: string | null;
}

function rowToAppSettings(row: AppSettingsRow): AppSettings {
  const sidebarLayout: SidebarLayoutEntry[] | null = row.sidebar_layout
    ? JSON.parse(row.sidebar_layout)
    : null;
  return AppSettingsSchema.parse({
    id: 1,
    sidebarLayout,
    notificationsEnabled: row.notifications_enabled === 1,
    notificationDay: row.notification_day,
    refreshCadence: row.refresh_cadence,
    lastRefreshAt: row.last_refresh_at,
    statementsFolderPath: row.statements_folder_path,
  });
}

export class SettingsRepo {
  constructor(private db: Database) {}

  async get(): Promise<AppSettings> {
    const rows = await this.db.select<AppSettingsRow>(
      'SELECT * FROM app_settings WHERE id = 1',
    );
    if (rows.length === 0) {
      throw new Error('app_settings singleton row missing — migration 0014 may not have run');
    }
    return rowToAppSettings(rows[0]);
  }

  async update(patch: Partial<Omit<AppSettings, 'id'>>): Promise<void> {
    const current = await this.get();
    const merged = { ...current, ...patch };
    AppSettingsSchema.parse(merged);

    await this.db.execute(
      `UPDATE app_settings SET
        sidebar_layout = ?,
        notifications_enabled = ?,
        notification_day = ?,
        refresh_cadence = ?,
        last_refresh_at = ?,
        statements_folder_path = ?
       WHERE id = 1`,
      [
        merged.sidebarLayout === null ? null : JSON.stringify(merged.sidebarLayout),
        merged.notificationsEnabled ? 1 : 0,
        merged.notificationDay,
        merged.refreshCadence,
        merged.lastRefreshAt,
        merged.statementsFolderPath,
      ],
    );
  }
}
