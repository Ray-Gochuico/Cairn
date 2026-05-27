-- 0030_enable_foreign_keys_and_orphan_cleanup.sql
--
-- WHY: Migration 0001 declared 29 `ON DELETE CASCADE` / `ON DELETE SET NULL`
-- clauses, but `TauriAdapter.load` never set `PRAGMA foreign_keys = ON`. SQLite
-- defaults FKs OFF per connection, so all of those cascades have been silent
-- no-ops in real user databases since v0.1.0. Tests passed because
-- `SqliteAdapter` (test adapter) AND the browser shim both turn FKs on at
-- construction — only production was drifting.
--
-- This migration is a one-shot janitorial pass to remove the orphan rows
-- accumulated during the buggy window. The companion fix in
-- `src/db/tauri-adapter.ts` now enables FKs on every new connection, so this
-- problem cannot recur.
--
-- On a fresh database this migration is a harmless no-op (every DELETE runs
-- against an empty child table or an empty orphan set).
--
-- The cleanup is grouped by relationship in the order the schema declared
-- them (see `0001_initial.sql`).

-- ── household → ... ─────────────────────────────────────────────────────────
-- household is a singleton (CHECK id = 1). Any child whose household_id is
-- not 1 is by definition an orphan.

DELETE FROM persons WHERE household_id NOT IN (SELECT id FROM household);
DELETE FROM dependents WHERE household_id NOT IN (SELECT id FROM household);
DELETE FROM accounts WHERE household_id NOT IN (SELECT id FROM household);
DELETE FROM loans WHERE household_id NOT IN (SELECT id FROM household);
DELETE FROM equity_grants WHERE household_id NOT IN (SELECT id FROM household);
DELETE FROM properties WHERE household_id NOT IN (SELECT id FROM household);
DELETE FROM vehicles WHERE household_id NOT IN (SELECT id FROM household);
DELETE FROM goals WHERE household_id NOT IN (SELECT id FROM household);
DELETE FROM transactions WHERE household_id NOT IN (SELECT id FROM household);
DELETE FROM merchant_category_overrides WHERE household_id NOT IN (SELECT id FROM household);

-- 0017_disclosure_foundations and 0018_roadmap_rule_engine added
-- `disclosure_acceptances` and `roadmap_node_overrides`. Both declare an FK
-- to household(id) without an ON DELETE clause (defaults to NO ACTION), but
-- the spirit was that household-scoped audit rows shouldn't outlive the
-- household. Sweep them too while we're here.
DELETE FROM disclosure_acceptances WHERE household_id NOT IN (SELECT id FROM household);
DELETE FROM roadmap_node_overrides WHERE household_id NOT IN (SELECT id FROM household);

-- ── accounts → ... (CASCADE) ────────────────────────────────────────────────
-- holdings, contributions, account_snapshots all CASCADE-deleted with their
-- parent account; in the FKs-off window these survived as ghosts contributing
-- to Net Worth / Investments aggregates.
DELETE FROM holdings WHERE account_id NOT IN (SELECT id FROM accounts);
DELETE FROM contributions WHERE account_id NOT IN (SELECT id FROM accounts);
DELETE FROM account_snapshots WHERE account_id NOT IN (SELECT id FROM accounts);

-- ── loans → loan_payments (CASCADE) ────────────────────────────────────────
DELETE FROM loan_payments WHERE loan_id NOT IN (SELECT id FROM loans);

-- ── persons → equity_grants (CASCADE) ──────────────────────────────────────
DELETE FROM equity_grants WHERE owner_person_id NOT IN (SELECT id FROM persons);

-- ── categories → ... (CASCADE) ──────────────────────────────────────────────
DELETE FROM merchant_category_overrides WHERE category_id NOT IN (SELECT id FROM categories);
DELETE FROM merchant_seed_mapping WHERE category_id NOT IN (SELECT id FROM categories);

-- ── persons → ... (SET NULL) ────────────────────────────────────────────────
-- For SET NULL relationships, set dangling refs to NULL instead of deleting
-- the child row.
UPDATE accounts SET owner_person_id = NULL
  WHERE owner_person_id IS NOT NULL
    AND owner_person_id NOT IN (SELECT id FROM persons);
UPDATE contributions SET person_id = NULL
  WHERE person_id IS NOT NULL
    AND person_id NOT IN (SELECT id FROM persons);
UPDATE loans SET obligor_person_id = NULL
  WHERE obligor_person_id IS NOT NULL
    AND obligor_person_id NOT IN (SELECT id FROM persons);
UPDATE properties SET owner_person_id = NULL
  WHERE owner_person_id IS NOT NULL
    AND owner_person_id NOT IN (SELECT id FROM persons);
UPDATE vehicles SET owner_person_id = NULL
  WHERE owner_person_id IS NOT NULL
    AND owner_person_id NOT IN (SELECT id FROM persons);
UPDATE goals SET for_person_id = NULL
  WHERE for_person_id IS NOT NULL
    AND for_person_id NOT IN (SELECT id FROM persons);
UPDATE transactions SET person_id = NULL
  WHERE person_id IS NOT NULL
    AND person_id NOT IN (SELECT id FROM persons);

-- ── dependents → accounts.beneficiary_dependent_id (SET NULL) ──────────────
UPDATE accounts SET beneficiary_dependent_id = NULL
  WHERE beneficiary_dependent_id IS NOT NULL
    AND beneficiary_dependent_id NOT IN (SELECT id FROM dependents);

-- ── loans → properties.linked_loan_id / vehicles.linked_loan_id (SET NULL) ─
UPDATE properties SET linked_loan_id = NULL
  WHERE linked_loan_id IS NOT NULL
    AND linked_loan_id NOT IN (SELECT id FROM loans);
UPDATE vehicles SET linked_loan_id = NULL
  WHERE linked_loan_id IS NOT NULL
    AND linked_loan_id NOT IN (SELECT id FROM loans);

-- ── categories → ... (SET NULL) ────────────────────────────────────────────
UPDATE categories SET parent_category_id = NULL
  WHERE parent_category_id IS NOT NULL
    AND parent_category_id NOT IN (SELECT id FROM categories);
UPDATE transactions SET category_id = NULL
  WHERE category_id IS NOT NULL
    AND category_id NOT IN (SELECT id FROM categories);

-- ── accounts → transactions.source_account_id (SET NULL) ───────────────────
UPDATE transactions SET source_account_id = NULL
  WHERE source_account_id IS NOT NULL
    AND source_account_id NOT IN (SELECT id FROM accounts);

-- ── properties → transactions.property_id (SET NULL, added in 0008) ────────
UPDATE transactions SET property_id = NULL
  WHERE property_id IS NOT NULL
    AND property_id NOT IN (SELECT id FROM properties);

-- ── vehicles → transactions.vehicle_id (SET NULL, added in 0008) ───────────
UPDATE transactions SET vehicle_id = NULL
  WHERE vehicle_id IS NOT NULL
    AND vehicle_id NOT IN (SELECT id FROM vehicles);
