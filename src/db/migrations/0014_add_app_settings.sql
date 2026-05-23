-- 0014_add_app_settings.sql
-- App-level user preferences. A strict singleton: exactly one row, id = 1,
-- seeded here so SettingsRepo.get() always finds it. Mirrors the `household`
-- singleton. NULL sidebar_layout / statements_folder_path mean "not set —
-- use defaults". Column defaults reproduce the pre-Settings hardcoded
-- behavior: monthly notification on day 1; market-data refresh every launch.
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sidebar_layout TEXT,
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  notification_day INTEGER NOT NULL DEFAULT 1,
  refresh_cadence TEXT NOT NULL DEFAULT 'EVERY_LAUNCH',
  last_refresh_at TEXT,
  statements_folder_path TEXT
);
INSERT OR IGNORE INTO app_settings (id) VALUES (1);
