-- 0016_add_ticker_sector_industry.sql
-- Add sector and industry classification to tickers.
-- Both nullable; populated by Yahoo enrichment (see ticker-enrichment.ts).
-- Existing tickers start with NULL and backfill lazily on the next refresh.
ALTER TABLE tickers ADD COLUMN sector TEXT;
ALTER TABLE tickers ADD COLUMN industry TEXT;
