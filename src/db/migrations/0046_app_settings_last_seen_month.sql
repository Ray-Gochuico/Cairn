-- 0046_app_settings_last_seen_month.sql
-- Tracks the YYYY-MM of the most recent month for which the app surfaced the
-- monthly-input ritual prompt. Drives the once-per-month auto-route to
-- /monthly on the first app open of a new calendar month (Wave 3). Peer to
-- last_refresh_at — app/UI state, not household financial data.
-- Nullable: NULL = never prompted (first-ever open) => prompt on next open.
ALTER TABLE app_settings ADD COLUMN last_seen_month TEXT;
