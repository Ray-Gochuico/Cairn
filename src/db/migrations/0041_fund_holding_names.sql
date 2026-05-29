-- 0041_fund_holding_names.sql
-- Adds a human-readable name for each fund holding, sourced from Yahoo's
-- quoteSummary topHoldings.holdingName (e.g. "NVIDIA Corp" for NVDA). Most
-- look-through underlyings aren't in the local tickers table, so this is the
-- only place we have names for them — the Per-company exposure donut legend
-- uses it to render "Company Name (TICKER)" instead of a bare ticker.
-- Nullable: Yahoo occasionally omits holdingName, and existing rows backfill
-- to NULL until the next fund-holdings sync refreshes them.
ALTER TABLE fund_holdings ADD COLUMN holding_name TEXT;
