-- 0025_compounding_frequency.sql
-- Adds a household-level default compounding frequency on app_settings.
-- Used by the What-If Returns lever and Cash APY math to model
-- alternative compounding regimes (e.g. daily-compound HYSA, quarterly
-- dividends). MONTHLY preserves pre-Task-16 behavior exactly.
ALTER TABLE app_settings ADD COLUMN default_compounding_frequency TEXT NOT NULL
  DEFAULT 'MONTHLY'
  CHECK (default_compounding_frequency IN ('DAILY','WEEKLY','MONTHLY','QUARTERLY','ANNUALLY'));
