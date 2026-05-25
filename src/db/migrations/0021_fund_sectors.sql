-- 0021_fund_sectors.sql
-- Per-fund sector breakdown sourced from Yahoo's quoteSummary topHoldings.sectorWeightings.
-- Used by the Investments page's sector donut so a fund's exposure is
-- distributed proportionally across sectors (e.g. VTI ~28% Technology) instead
-- of bucketing the whole fund into "Unclassified" when fund_holdings is empty.
CREATE TABLE IF NOT EXISTS fund_sectors (
  fund_ticker TEXT NOT NULL,
  sector TEXT NOT NULL,
  weight REAL NOT NULL,
  as_of_date TEXT NOT NULL,
  PRIMARY KEY (fund_ticker, sector)
);
