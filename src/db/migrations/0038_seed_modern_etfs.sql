-- 0037_seed_modern_etfs.sql
-- Backfills tickers that are commonly held but were missing from the original
-- 0006_seed_tickers.sql list. Without these rows the asset_class lookup falls
-- back to "Other" in the Investments allocation donut, even though the fund
-- has a well-defined classification.
--
-- Uses INSERT OR IGNORE so existing users who already added the ticker
-- manually (user_added=1) are unaffected.
--
-- First entry: IDEV (iShares Core MSCI International Developed Markets ETF),
-- which belongs in INTL_DEVELOPED alongside VXUS/VEA/IEFA/SCHF/EFA from 0006.

INSERT OR IGNORE INTO tickers (ticker, name, asset_class, leverage_factor, direction, user_added) VALUES
('IDEV', 'iShares Core MSCI International Developed Markets ETF', 'INTL_DEVELOPED', 1.0, 'LONG', 0)
;
