-- 0036_add_rent_lease_tracking.sql
-- Recurring monthly obligations (v1.1, 2026-05-27).
--
-- Renters and lessees don't have a cost basis, market value, or linked loan;
-- they have a name + monthly amount + start date + optional end date. Two
-- separate tables (rather than one polymorphic table) keep the UI and the
-- What-If engine's per-month aggregation readable and let v2 grow each shape
-- independently (e.g., lease may add mileage cap; rent may add security
-- deposit).
--
-- owner_person_id is nullable = "joint / household" per the view-filter
-- convention. ON DELETE SET NULL mirrors properties/vehicles so deleting a
-- person doesn't cascade away their rental history.

CREATE TABLE IF NOT EXISTS housing_payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id    INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  owner_person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  monthly_amount  REAL NOT NULL,
  start_date      TEXT NOT NULL,
  end_date        TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_housing_payments_household
  ON housing_payments(household_id);

CREATE TABLE IF NOT EXISTS vehicle_leases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id    INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  owner_person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  monthly_amount  REAL NOT NULL,
  start_date      TEXT NOT NULL,
  end_date        TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vehicle_leases_household
  ON vehicle_leases(household_id);
