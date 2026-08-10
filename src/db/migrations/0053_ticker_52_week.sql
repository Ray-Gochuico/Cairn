-- 0053_ticker_52_week.sql
-- Nullable 52-week range on tickers (Positions table, D-P4 revised).
-- Populated by the existing user-initiated market-data refresh
-- (updateTicker52Week in ticker-enrichment.ts); existing rows start NULL
-- and render "—" until the next refresh fetches them.
ALTER TABLE tickers ADD COLUMN fifty_two_week_low REAL;
ALTER TABLE tickers ADD COLUMN fifty_two_week_high REAL;
