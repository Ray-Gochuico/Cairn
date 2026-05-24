-- 0018_roadmap_rule_engine.sql
-- Adds the rule-engine support columns for Track R (Roadmap):
--   - Threshold overrides (Settings → Advanced) for debt classification.
--   - Chart-answer columns on household / persons / accounts populated
--     by decision nodes asking the user one-off yes/no/enum questions.
--   - roadmap_node_overrides: per-node user override of a computed status.
--
-- All additions are nullable / opt-in so existing households are picked
-- up by the rule engine as "no answer yet" — the matching decision nodes
-- will surface as 'unanswered' until the user fills them in.

-- Threshold overrides (REAL = percent stored as e.g. 5.0 for 5%).
ALTER TABLE household ADD COLUMN interest_threshold_low_pct  REAL;
ALTER TABLE household ADD COLUMN interest_threshold_high_pct REAL;

-- Household-level chart answers (INTEGER 0/1 for boolean, REAL for $).
ALTER TABLE household ADD COLUMN has_written_ips           INTEGER;
ALTER TABLE household ADD COLUMN has_hsa_qualified_hdhp    INTEGER;
ALTER TABLE household ADD COLUMN makes_charitable_gifts    INTEGER;
ALTER TABLE household ADD COLUMN upcoming_large_purchase   INTEGER;
ALTER TABLE household ADD COLUMN upcoming_purchase_amount  REAL;
ALTER TABLE household ADD COLUMN upcoming_purchase_months  INTEGER;

-- Person-level chart answers.
ALTER TABLE persons ADD COLUMN job_stability                TEXT;     -- 'stable' | 'unstable'
ALTER TABLE persons ADD COLUMN expects_higher_future_income INTEGER;
ALTER TABLE persons ADD COLUMN on_parent_health_insurance   INTEGER;
ALTER TABLE persons ADD COLUMN is_relatively_healthy        INTEGER;

-- Account-level chart answers.
ALTER TABLE accounts ADD COLUMN has_employer_match             INTEGER;
ALTER TABLE accounts ADD COLUMN employer_match_pct             REAL;
ALTER TABLE accounts ADD COLUMN employer_match_limit_pct       REAL;
ALTER TABLE accounts ADD COLUMN allows_mega_backdoor_rollover  INTEGER;
ALTER TABLE accounts ADD COLUMN has_high_fees                  INTEGER;

-- Per-node user override of the computed status. UNIQUE keeps a single
-- live override per (household, node) — overwriting updates in place.
CREATE TABLE IF NOT EXISTS roadmap_node_overrides (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id    INTEGER NOT NULL REFERENCES household(id),
  node_id         TEXT NOT NULL,
  override_status TEXT NOT NULL,
  note            TEXT,
  set_at          TEXT NOT NULL,
  UNIQUE(household_id, node_id)
);
