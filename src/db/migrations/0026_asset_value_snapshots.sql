-- 0026_asset_value_snapshots.sql
-- Manually entered dated value snapshots for properties and vehicles.
-- One row per (owner_type, owner_id, snapshot_date). Drives the Net Worth
-- page's stacked time-series chart and the asset donut for properties /
-- vehicles, with the latest-snapshot-<=-bucket-end picking the displayed
-- value per bucket. Cascading deletes are enforced at the repo layer
-- (PropertiesRepo.delete / VehiclesRepo.delete) — there is no SQL FK
-- because owner_type is a discriminated union (PROPERTY | VEHICLE).
CREATE TABLE asset_value_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type    TEXT NOT NULL CHECK (owner_type IN ('PROPERTY', 'VEHICLE')),
  owner_id      INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  value         REAL NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_asset_value_snapshots_owner
  ON asset_value_snapshots(owner_type, owner_id, snapshot_date);
