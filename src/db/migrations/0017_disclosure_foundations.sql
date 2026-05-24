-- 0017_disclosure_foundations.sql
-- Two-layer disclosure-acceptance system for Track R (Roadmap).
-- Adds 4 nullable cache columns to household + a versioned audit table.
-- The cache columns hold the latest accepted version per document;
-- disclosure_acceptances is the append-only audit trail.
-- Existing households start with NULL across the new columns and are
-- caught by AppDisclaimerGate / the Setup Wizard Step 0 on next launch.

ALTER TABLE household ADD COLUMN disclaimer_accepted_at TEXT;
ALTER TABLE household ADD COLUMN disclaimer_version_accepted TEXT;
ALTER TABLE household ADD COLUMN roadmap_disclaimer_accepted_at TEXT;
ALTER TABLE household ADD COLUMN roadmap_disclaimer_version_accepted TEXT;

CREATE TABLE IF NOT EXISTS disclosure_acceptances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id  INTEGER NOT NULL REFERENCES household(id),
  document_id   TEXT NOT NULL,
  version       TEXT NOT NULL,
  accepted_at   TEXT NOT NULL,
  UNIQUE(household_id, document_id, version)
);
