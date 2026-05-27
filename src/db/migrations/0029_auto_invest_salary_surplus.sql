-- 0029 — Household-level "auto-invest salary surplus" toggle.
--
-- Controls whether the What-If engine auto-invests positive monthly surplus
-- (income − expenses − loan payments) when no explicit Contributions segment
-- is active. Default OFF: surplus stays in cash unless the user opts in via
-- Settings → Advanced. Existing households see their projections shift
-- accordingly until they flip the toggle on.
ALTER TABLE app_settings ADD COLUMN auto_invest_salary_surplus INTEGER NOT NULL DEFAULT 0;
