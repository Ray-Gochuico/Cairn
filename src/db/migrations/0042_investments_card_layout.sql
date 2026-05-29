-- 0042_investments_card_layout.sql
-- Per-page customization for the Investments page: which top-level cards show
-- and in what order. JSON array of { id, hidden } applied over the hardcoded
-- card registry (see src/lib/investments-card-layout.ts), exactly mirroring
-- how sidebar_layout (0-prefixed migrations) overlays the sidebar defaults.
-- NULL = "no customization" → registry defaults, all visible.
ALTER TABLE app_settings ADD COLUMN investments_card_layout TEXT;
