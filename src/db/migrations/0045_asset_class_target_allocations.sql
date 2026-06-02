-- 0045_asset_class_target_allocations.sql
-- Household-level asset-class target allocations (the class-led hierarchy's
-- strategic envelope). JSON array of { assetClass, targetPct } where targetPct
-- is a 0..1 fraction of the WHOLE portfolio; Σ targetPct ≤ 1 is enforced in
-- SettingsRepo/the form (NOT in SQL), mirroring the propertyUtilitiesCategoryIds
-- pattern. NULL = "no class targets set" → tables/allocator fall back to
-- per-ticker-only behavior. Per-ticker targets remain on holdings.target_allocation_pct.
ALTER TABLE app_settings ADD COLUMN asset_class_target_allocations TEXT;
