-- Migration 0020 — What-If projection defaults.
--
-- Adds two nullable columns to the app_settings singleton row. They drive the
-- "Default inflation rate" and "Default investment return rate" inputs exposed
-- by the Settings → Advanced section, and feed the What-If projection engine's
-- fallback values when a scenario does not override them. Nullable so the seed
-- row (and any installs that ran the earlier 0014 migration) read as NULL until
-- the user supplies a value; the engine falls back to its built-in defaults.

ALTER TABLE app_settings ADD COLUMN default_inflation REAL;
ALTER TABLE app_settings ADD COLUMN default_return_rate REAL;
