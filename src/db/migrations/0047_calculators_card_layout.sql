-- 0047_calculators_card_layout.sql
-- Single source of truth for which calculator cards are visible on the
-- Calculators page. JSON array of { id, hidden } applied over the hardcoded
-- card registry (see src/lib/calculator-card-layout.ts), exactly mirroring
-- investments_card_layout (migration 0042) and how sidebar_layout overlays
-- the sidebar defaults. NULL = "no customization" → all cards visible.
-- Replaces the legacy localStorage key 'calculator-hidden-cards', which is
-- imported once (importCalcVisibilityIfNeeded) then cleared.
ALTER TABLE app_settings ADD COLUMN calculator_card_layout TEXT;
