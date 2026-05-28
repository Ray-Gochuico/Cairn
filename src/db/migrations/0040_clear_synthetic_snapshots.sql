-- 0039_clear_synthetic_snapshots.sql
-- The app removed its backward snapshot backfill (which synthesized
-- net-worth history by deriving prior account values). This one-time
-- cleanup deletes all of those auto-derived snapshots so history restarts
-- forward-only from this point on.
--
-- Only source = 'AUTO_DERIVED' rows are removed. User-entered snapshots
-- (MANUAL / USER_CONFIRMED / CSV_IMPORT) are deliberately preserved, since
-- those represent real history the user supplied rather than backfilled
-- estimates.

DELETE FROM account_snapshots WHERE source = 'AUTO_DERIVED';
