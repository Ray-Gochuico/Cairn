-- 0043_drop_household_disclosure_columns.sql
-- Disclosure single-source-of-truth retirement (v1.1, 2026-05-28).
--
-- The disclosure gate now reads disclosure_acceptances exclusively (the
-- normalized table added in 0017). The four household cache columns added in
-- 0017 are redundant dual-state and are dropped here. Cairn has zero installed
-- users (v1.0 not yet shipped), so there is no acceptance data to back up —
-- the audit table already holds the only truth.
--
-- SQLite ALTER TABLE ... DROP COLUMN requires SQLite >= 3.35.0. The bundled
-- engine (libsqlite3-sys 0.30.x via tauri-plugin-sql 2.x → SQLite 3.46+)
-- supports it; better-sqlite3 in tests is likewise modern. One column per
-- statement (SQLite drops a single column per ALTER).

ALTER TABLE household DROP COLUMN disclaimer_accepted_at;
ALTER TABLE household DROP COLUMN disclaimer_version_accepted;
ALTER TABLE household DROP COLUMN roadmap_disclaimer_accepted_at;
ALTER TABLE household DROP COLUMN roadmap_disclaimer_version_accepted;
