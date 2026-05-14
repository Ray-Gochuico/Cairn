-- 0003_add_commission_columns.sql
-- Adds expected commission fields to persons. Commission replaces expectedBonus as the
-- recurring supplemental-income field on the Person input form. Bonus stays in the
-- DB schema for backwards compatibility but is no longer surfaced on the form.

ALTER TABLE persons ADD COLUMN expected_commission REAL NOT NULL DEFAULT 0;
ALTER TABLE persons ADD COLUMN expected_commission_frequency TEXT NOT NULL DEFAULT 'MONTHLY';
