-- 0019_scenarios.sql
-- Adds the scenarios table powering the What-If simulator.
-- One row per saved scenario; exactly one row carries the baseline flag,
-- exactly one row is "active" at a time (enforced by partial unique indexes).
--
-- lever_payload is a JSON-encoded LeverPayload (see src/lib/scenarios/lever-types.ts).
-- The repo Zod-validates the parsed payload on every read so a malformed
-- blob surfaces immediately at the boundary instead of silently propagating.

CREATE TABLE scenarios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  is_baseline     INTEGER NOT NULL DEFAULT 0,
  color           TEXT    NOT NULL,
  line_style      TEXT    NOT NULL DEFAULT 'solid',
  visible         INTEGER NOT NULL DEFAULT 1,
  is_active       INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  lever_payload   TEXT    NOT NULL DEFAULT '{}',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX scenarios_one_baseline ON scenarios(is_baseline) WHERE is_baseline = 1;
CREATE UNIQUE INDEX scenarios_one_active   ON scenarios(is_active)   WHERE is_active   = 1;
