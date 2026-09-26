import type { SqliteAdapter } from '@/db/sqlite-adapter';

/**
 * v1.7.1 U3 — rows for the released-schema upgrade harness
 * (tests/db/upgrade-path.test.ts). A synthetic replay is faithful to the SQL's
 * bytes and order but not to a user's data, so these rows reach the
 * data-dependent branches: seeded at schema 29, BEFORE 0030 (the orphan sweep),
 * 0031 (the federal 2026 UPDATE) and 0033 (the FK-action table rebuild) run.
 * The orphans go in with foreign keys OFF, the way prod wrote them before 0030
 * (src/db/tauri-adapter.ts:34-41).
 */
export async function seedBefore0030(db: SqliteAdapter): Promise<void> {
  const rows = [
    "INSERT INTO persons (id, household_id, name, date_of_birth, target_retirement_age) VALUES (1, 1, 'Ada', '1990-01-01', 65)",
    "INSERT INTO accounts (id, household_id, owner_person_id, name, type) VALUES (1, 1, 1, 'Brokerage', 'BROKERAGE')",
    "INSERT INTO holdings (account_id, ticker, share_count) VALUES (1, 'VTI', 10)",
    "INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at) VALUES (1, 'app_wide', '1.0', '2026-01-01T00:00:00Z')",
    "INSERT INTO roadmap_node_overrides (household_id, node_id, override_status, set_at) VALUES (1, 'emergency_fund', 'DONE', '2026-01-01T00:00:00Z')",
    'PRAGMA foreign_keys = OFF',
    "INSERT INTO persons (id, household_id, name, date_of_birth, target_retirement_age) VALUES (99, 2, 'Orphan', '1990-01-01', 65)",
    "INSERT INTO holdings (account_id, ticker, share_count) VALUES (999, 'ORPH', 1)",
    "INSERT INTO account_snapshots (account_id, snapshot_date, total_value, source) VALUES (999, '2026-01-01', 1, 'MANUAL')",
    "INSERT INTO accounts (id, household_id, owner_person_id, name, type) VALUES (2, 1, 777, 'Checking', 'CHECKING')",
    'PRAGMA foreign_keys = ON',
  ];
  for (const sql of rows) await db.execute(sql);
}

/** One row in every user table a released file at schema `n` can hold (every table exists by 47; interview_answers arrives in 0052). */
export async function seedAtSchema(db: SqliteAdapter, n: number): Promise<void> {
  const rows = [
    "INSERT INTO dependents (household_id, name, date_of_birth, type) VALUES (1, 'Kid', '2015-01-01', 'CHILD')",
    "INSERT INTO contributions (account_id, person_id, date, amount, source) VALUES (1, 1, '2026-01-01', 100, 'MANUAL')",
    "INSERT INTO account_snapshots (account_id, snapshot_date, total_value, source) VALUES (1, '2026-01-01', 1000, 'MANUAL')",
    "INSERT INTO loans (id, household_id, obligor_person_id, name, type, original_amount, current_balance, interest_rate, term_months, first_payment_date, monthly_payment) VALUES (1, 1, 1, 'Car loan', 'AUTO', 10000, 8000, 0.05, 60, '2025-01-01', 200)",
    "INSERT INTO loan_payments (loan_id, payment_date, principal, interest, source) VALUES (1, '2026-01-01', 150, 50, 'AMORTIZATION')",
    "INSERT INTO properties (id, household_id, owner_person_id, name, type, current_estimated_value) VALUES (1, 1, 1, 'Home', 'PRIMARY', 500000)",
    "INSERT INTO vehicles (id, household_id, owner_person_id, name, linked_loan_id) VALUES (1, 1, 1, 'Car', 1)",
    "INSERT INTO asset_value_snapshots (owner_type, owner_id, snapshot_date, value) VALUES ('PROPERTY', 1, '2026-01-01', 500000)",
    "INSERT INTO equity_grants (household_id, owner_person_id, name, grant_date, strike_price, total_shares, vesting_schedule) VALUES (1, 1, 'RSU grant', '2025-01-01', 0, 100, '[]')",
    "INSERT INTO goals (household_id, for_person_id, name, type, target_amount, target_date) VALUES (1, 1, 'Trip', 'SAVINGS', 5000, '2027-01-01')",
    "INSERT INTO housing_payments (household_id, owner_person_id, name, monthly_amount, start_date) VALUES (1, 1, 'Rent', 2000, '2025-01-01')",
    "INSERT INTO vehicle_leases (household_id, owner_person_id, name, monthly_amount, start_date) VALUES (1, 1, 'Lease', 300, '2025-01-01')",
    "INSERT INTO transactions (household_id, date, merchant, amount, source_account_id, person_id, property_id, vehicle_id) VALUES (1, '2026-01-02', 'Store', -20, 1, 1, 1, 1)",
    "INSERT INTO merchant_category_overrides (household_id, merchant_pattern, category_id) VALUES (1, 'STORE', (SELECT MIN(id) FROM categories))",
    "INSERT INTO fund_holdings (fund_ticker, holding_ticker, weight, as_of_date) VALUES ('VTI', 'AAPL', 0.06, '2026-01-01')",
    "INSERT INTO fund_sectors (fund_ticker, sector, weight, as_of_date) VALUES ('VTI', 'Technology', 0.3, '2026-01-01')",
    "INSERT INTO price_cache (ticker, date, price) VALUES ('VTI', '2026-01-01', 250)",
    "INSERT INTO learning_answers (question_id, answered_iso_date, chosen_index, was_correct, question_version) VALUES ('q1', '2026-01-01', 0, 1, 1)",
    "INSERT INTO scenarios (name, color) VALUES ('Baseline', '#336699')",
  ];
  if (n >= 52) {
    rows.push(
      "INSERT INTO interview_answers (household_id, thread_id, question_id, value_json, question_version, answered_at) VALUES (1, 'next_dollar', 'q1', '1', 1, '2026-01-01T00:00:00Z')",
    );
  }
  for (const sql of rows) await db.execute(sql);
}
