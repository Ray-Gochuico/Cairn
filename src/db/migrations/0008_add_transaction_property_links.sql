-- 0008_add_transaction_property_links.sql
-- Nullable links from a transaction to the property / vehicle it belongs to,
-- for capital-improvement cost basis and per-entity rolling expense.
ALTER TABLE transactions ADD COLUMN property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL;
