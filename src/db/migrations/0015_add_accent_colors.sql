-- 0015_add_accent_colors.sql
-- User-customizable chart colors. A nullable accent_color hex string on
-- accounts and tickers. NULL means "no override — use the deterministic
-- palette default" (id-modulo for accounts, ticker-hash for tickers).
-- Honored by the Investment time-series chart and the per-company donut.
ALTER TABLE accounts ADD COLUMN accent_color TEXT;
ALTER TABLE tickers ADD COLUMN accent_color TEXT;
