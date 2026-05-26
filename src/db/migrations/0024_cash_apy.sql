-- 0024_cash_apy.sql
-- Adds per-account APY rate for cash/savings projection growth,
-- and a household-level default fallback on app_settings.
-- Both columns are NULL by default: NULL means "fall through to next resolution step".
ALTER TABLE accounts ADD COLUMN apy_rate REAL NULL;
ALTER TABLE app_settings ADD COLUMN default_cash_apy REAL NULL;
