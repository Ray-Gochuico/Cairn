-- 0022_fi_pills_position.sql
-- Allow the user to position the FI / Coast FI pill row above or below the
-- projection chart on the What-If page. Default 'above' matches existing
-- behavior so the migration is a no-op for in-flight households.
ALTER TABLE app_settings
  ADD COLUMN default_fi_pills_position TEXT NOT NULL DEFAULT 'above'
    CHECK (default_fi_pills_position IN ('above', 'below'));
