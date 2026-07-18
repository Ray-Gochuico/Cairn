-- 0050_app_settings_briefing_stamps.sql
-- "Since your last visit" dashboard briefing (Wave 13 / design Direction 1).
-- last_visit_date: local calendar day (YYYY-MM-DD) of the most recent app
-- open. briefing_baseline_date: the visit-day BEFORE that — the briefing's
-- net-worth baseline for every open today. Two columns so a same-day re-open
-- keeps a stable baseline instead of comparing today to itself.
-- Peers to last_seen_month / last_refresh_at — app/UI state, not household
-- financial data. Nullable: NULL = first-ever open => "Since <last month>".
ALTER TABLE app_settings ADD COLUMN last_visit_date TEXT;
ALTER TABLE app_settings ADD COLUMN briefing_baseline_date TEXT;
