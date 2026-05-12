-- 0001_initial.sql
-- Initial schema for finance app, Phase 1 includes households, persons, dependents.
-- Other tables created as empty/structural now so we don't migrate again.

CREATE TABLE IF NOT EXISTS household (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT,
  filing_status TEXT NOT NULL CHECK (filing_status IN ('SINGLE', 'MFJ', 'MFS', 'HOH')),
  state TEXT NOT NULL,
  city TEXT,
  monthly_expense_baseline REAL NOT NULL DEFAULT 0,
  withdrawal_rate REAL NOT NULL DEFAULT 0.04,
  inflation_assumption REAL NOT NULL DEFAULT 0.024,
  growth_scenarios TEXT NOT NULL DEFAULT '[{"label":"Conservative","rate":0.05},{"label":"Moderate","rate":0.06},{"label":"Optimistic","rate":0.07},{"label":"Bull","rate":0.08}]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  target_retirement_age INTEGER NOT NULL,
  annual_salary_pretax REAL NOT NULL DEFAULT 0,
  expected_bonus REAL NOT NULL DEFAULT 0,
  pretax_401k_pct REAL NOT NULL DEFAULT 0,
  health_insurance_monthly_premium REAL NOT NULL DEFAULT 0,
  dependent_care_fsa_monthly REAL NOT NULL DEFAULT 0,
  hsa_monthly_contribution REAL NOT NULL DEFAULT 0,
  hsa_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dependents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('CHILD', 'OTHER')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Phase 2+ tables: created now to avoid future migration breakage. Empty until later phases.

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  owner_person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  beneficiary_dependent_id INTEGER REFERENCES dependents(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  institution TEXT,
  type TEXT NOT NULL,
  crypto_wallet_address TEXT,
  auto_fetch_enabled INTEGER NOT NULL DEFAULT 0,
  excluded_from_net_worth INTEGER NOT NULL DEFAULT 0,
  state_of_plan TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  share_count REAL NOT NULL DEFAULT 0,
  target_allocation_pct REAL,
  cost_basis REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,
  total_value REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  obligor_person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  original_amount REAL NOT NULL,
  current_balance REAL NOT NULL,
  interest_rate REAL NOT NULL,
  term_months INTEGER NOT NULL,
  first_payment_date TEXT NOT NULL,
  monthly_payment REAL NOT NULL,
  extra_payment_default REAL NOT NULL DEFAULT 0,
  linked_property_id INTEGER,
  linked_vehicle_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loan_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  principal REAL NOT NULL,
  interest REAL NOT NULL,
  extra REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS equity_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  owner_person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company_name TEXT,
  grant_date TEXT NOT NULL,
  strike_price REAL NOT NULL,
  total_shares REAL NOT NULL,
  vesting_schedule TEXT NOT NULL,
  current_fmv REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  owner_person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  address TEXT,
  purchase_date TEXT,
  purchase_price REAL,
  current_estimated_value REAL,
  linked_loan_id INTEGER REFERENCES loans(id) ON DELETE SET NULL,
  excluded_from_net_worth INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  owner_person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  year INTEGER,
  make TEXT,
  model TEXT,
  purchase_date TEXT,
  purchase_price REAL,
  current_estimated_value REAL,
  linked_loan_id INTEGER REFERENCES loans(id) ON DELETE SET NULL,
  excluded_from_net_worth INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  for_person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  target_amount REAL NOT NULL,
  target_date TEXT NOT NULL,
  linked_account_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  color TEXT,
  icon TEXT,
  type TEXT NOT NULL,
  is_capital INTEGER NOT NULL DEFAULT 0,
  system_managed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  merchant TEXT NOT NULL,
  merchant_raw TEXT,
  amount REAL NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  source_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  source_pdf_filename TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reimbursable INTEGER NOT NULL DEFAULT 0,
  reimbursed_at TEXT,
  reimbursed_amount REAL,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS merchant_category_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  merchant_pattern TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_from_correction_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tickers (
  ticker TEXT PRIMARY KEY,
  name TEXT,
  asset_class TEXT NOT NULL,
  leverage_factor REAL NOT NULL DEFAULT 1.0,
  direction TEXT NOT NULL DEFAULT 'LONG',
  user_added INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fund_holdings (
  fund_ticker TEXT NOT NULL,
  holding_ticker TEXT NOT NULL,
  weight REAL NOT NULL,
  as_of_date TEXT NOT NULL,
  PRIMARY KEY (fund_ticker, holding_ticker, as_of_date)
);

CREATE TABLE IF NOT EXISTS price_cache (
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  price REAL NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticker, date)
);

CREATE TABLE IF NOT EXISTS tax_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  jurisdiction_type TEXT NOT NULL,
  jurisdiction_code TEXT NOT NULL,
  filing_status TEXT NOT NULL,
  brackets TEXT NOT NULL,
  standard_deduction REAL NOT NULL DEFAULT 0,
  UNIQUE(year, jurisdiction_type, jurisdiction_code, filing_status)
);

CREATE TABLE IF NOT EXISTS merchant_seed_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_pattern TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE
);

-- Track applied migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert the singleton household row with sane defaults if not present
INSERT OR IGNORE INTO household (id, filing_status, state, city, monthly_expense_baseline, withdrawal_rate, inflation_assumption)
VALUES (1, 'SINGLE', 'CA', NULL, 0, 0.04, 0.024);

-- Mark this migration as applied
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0001_initial');
