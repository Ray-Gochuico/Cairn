-- 0034_add_query_indexes.sql
--
-- WHY: The 2026-05-26 Data Architecture review measured ~9 ms / query for
-- time-bucketed scans on the transactions table at ~100k rows, with the plan
-- showing a full SCAN every time. Six FK-style columns serve as join /
-- filter / sort keys across the app's hot paths but were unindexed since
-- 0001_initial:
--
--   - transactions(date)              — Spending charts, monthly buckets, NetWorth time series
--   - transactions(category_id)       — Budget breakdowns, category pies
--   - transactions(source_account_id) — Per-account ledger views
--   - holdings(account_id)            — Net-worth aggregation (per-account holdings sum)
--   - contributions(account_id)       — Per-account contribution sums (FI projection)
--   - account_snapshots(account_id)   — Snapshot history per account
--
-- The review measured ~9 ms → ~1 ms on these once an index was present.
-- IF NOT EXISTS keeps the migration idempotent in case any of these were
-- already added out-of-band on a developer's DB.

CREATE INDEX IF NOT EXISTS idx_transactions_date
  ON transactions(date);

CREATE INDEX IF NOT EXISTS idx_transactions_category_id
  ON transactions(category_id);

CREATE INDEX IF NOT EXISTS idx_transactions_source_account_id
  ON transactions(source_account_id);

CREATE INDEX IF NOT EXISTS idx_holdings_account_id
  ON holdings(account_id);

CREATE INDEX IF NOT EXISTS idx_contributions_account_id
  ON contributions(account_id);

CREATE INDEX IF NOT EXISTS idx_account_snapshots_account_id
  ON account_snapshots(account_id);
