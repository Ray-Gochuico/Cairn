-- 0023_projection_detail_level.sql
-- Adds a persisted projection detail level default to app_settings.
-- Drives the 3-state toggle (single / tax_bucket / per_account) in the
-- What-If chart. Default 'tax_bucket' ships the richer view out-of-the-box.
ALTER TABLE app_settings
  ADD COLUMN default_projection_detail_level TEXT NOT NULL DEFAULT 'tax_bucket'
    CHECK (default_projection_detail_level IN ('single', 'tax_bucket', 'per_account'));
