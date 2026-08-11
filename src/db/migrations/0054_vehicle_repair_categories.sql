-- 0054_vehicle_repair_categories.sql
-- Configured override for the interview's vehicle-repair category bucket
-- (Wave A item 7, closing chip D-GI15). NULL = unconfigured — resolver
-- falls back to the seeded pair 'Vehicles › Vehicle Maintenance' +
-- 'Vehicles › Major Repairs'. JSON id-array TEXT, the
-- property_utilities_category_ids / vehicle_gas_category_ids precedent.
ALTER TABLE app_settings ADD COLUMN vehicle_repair_category_ids TEXT;
