-- 0028_utility_category_config.sql
-- Adds two nullable JSON-text columns on app_settings holding the user's
-- configurable category-id sets for the Property "Utilities" card and the
-- Vehicle "Gas" card. NULL = "unset; fall back to seeded defaults"
-- (resolver helper handles fallback). Repo layer validates contents via Zod.
ALTER TABLE app_settings ADD COLUMN property_utilities_category_ids TEXT;
ALTER TABLE app_settings ADD COLUMN vehicle_gas_category_ids TEXT;
