-- 0033_fix_disclosure_acceptance_fk_actions.sql
--
-- WHY: `disclosure_acceptances` (added 0017) and `roadmap_node_overrides`
-- (added 0018) both declare a foreign key to `household(id)` without an
-- `ON DELETE` clause. SQLite defaults to `NO ACTION`, so the moment any
-- code path executes `DELETE FROM household WHERE id = ?` against a row
-- with referencing children, SQLite raises
-- "FOREIGN KEY constraint failed" and the delete aborts.
--
-- The `applyBackup` restore flow does exactly that delete to wipe the
-- singleton household before restoring from a backup payload, which
-- means a household carrying any disclosure acceptance or roadmap
-- override (i.e. every real user) would fail to restore.
--
-- The 0030 orphan-cleanup migration already treated these tables as
-- "audit rows scoped to the household" by sweeping orphans alongside
-- the CASCADE children. This migration brings the declarative schema in
-- line with that intent: `ON DELETE CASCADE` on both household FKs.
--
-- SQLite does not support `ALTER TABLE ... ALTER CONSTRAINT`, so we use
-- the standard four-step rebuild:
--   1. CREATE TABLE <name>__new (... with the right FK action ...)
--   2. INSERT INTO <name>__new SELECT * FROM <name>
--   3. DROP TABLE <name>
--   4. ALTER TABLE <name>__new RENAME TO <name>
--
-- `PRAGMA foreign_keys` cannot be toggled inside a transaction. We disable
-- FKs first so the rebuild's DROP/RENAME doesn't fail half-way through,
-- then re-enable them. The migrations.ts statement splitter runs each
-- statement sequentially against the same connection, so transaction
-- state is preserved.

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- ── disclosure_acceptances ─────────────────────────────────────────────────
CREATE TABLE disclosure_acceptances__new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id  INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  document_id   TEXT NOT NULL,
  version       TEXT NOT NULL,
  accepted_at   TEXT NOT NULL,
  UNIQUE(household_id, document_id, version)
);

INSERT INTO disclosure_acceptances__new (id, household_id, document_id, version, accepted_at)
  SELECT id, household_id, document_id, version, accepted_at
  FROM disclosure_acceptances;

DROP TABLE disclosure_acceptances;

ALTER TABLE disclosure_acceptances__new RENAME TO disclosure_acceptances;

-- ── roadmap_node_overrides ─────────────────────────────────────────────────
CREATE TABLE roadmap_node_overrides__new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id    INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  node_id         TEXT NOT NULL,
  override_status TEXT NOT NULL,
  note            TEXT,
  set_at          TEXT NOT NULL,
  UNIQUE(household_id, node_id)
);

INSERT INTO roadmap_node_overrides__new (id, household_id, node_id, override_status, note, set_at)
  SELECT id, household_id, node_id, override_status, note, set_at
  FROM roadmap_node_overrides;

DROP TABLE roadmap_node_overrides;

ALTER TABLE roadmap_node_overrides__new RENAME TO roadmap_node_overrides;

COMMIT;

PRAGMA foreign_keys = ON;
