-- 0038_default_daily_refresh.sql
-- Market-data refresh used to run on every app launch (the seeded default
-- from 0014 was 'EVERY_LAUNCH'). The app has since moved to capping the
-- automatic refresh at once per day; manual "Refresh now" still works on
-- demand. This flips the seeded EVERY_LAUNCH default over to DAILY.
--
-- Because 0014 seeds the singleton settings row via
-- `INSERT OR IGNORE INTO app_settings (id) VALUES (1)`, refresh_cadence
-- takes the schema DEFAULT 'EVERY_LAUNCH' on every fresh install. Migrations
-- run in order even on a brand-new DB, so this UPDATE effectively becomes the
-- new default for everyone.
--
-- The UPDATE is scoped to refresh_cadence = 'EVERY_LAUNCH' so users who
-- explicitly picked another cadence (DAILY / WEEKLY / MANUAL) are left
-- untouched.

UPDATE app_settings SET refresh_cadence = 'DAILY' WHERE refresh_cadence = 'EVERY_LAUNCH';
