-- 0055_ticker_day_change.sql
-- Nullable regular-market day-change facts on tickers (Positions "Day change"
-- column, Wave B; numbered AFTER Wave A's 0054_vehicle_repair_categories). regular_market_change is the per-share $ move for the
-- market day current at the user's last refresh (SIGNED — losses negative);
-- regular_market_previous_close is that day's baseline close, stored so the
-- percent can be DERIVED (change / previous_close) instead of trusting a
-- second fetched unit. Populated by the existing user-initiated refresh
-- (updateTicker52WeekAndDayChange in ticker-enrichment.ts); existing rows
-- start NULL and render "—" until the next refresh fetches them.
ALTER TABLE tickers ADD COLUMN regular_market_change REAL;
ALTER TABLE tickers ADD COLUMN regular_market_previous_close REAL;
