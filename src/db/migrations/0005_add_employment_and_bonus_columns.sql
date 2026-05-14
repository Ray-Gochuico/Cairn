-- 0005_add_employment_and_bonus_columns.sql
-- Adds employment-type and bonus-frequency columns to persons. These fields are the
-- foundation for the OvertimeCalculator (12.6.4–12.6.5) and the BonusTaxCard
-- bonus-frequency feature (12.6.6). Note: expected_bonus already exists from
-- 0001_initial; this migration only adds the genuinely new columns.

ALTER TABLE persons ADD COLUMN employment_type TEXT NOT NULL DEFAULT 'SALARY_NO_OT';
ALTER TABLE persons ADD COLUMN hourly_rate REAL;
ALTER TABLE persons ADD COLUMN regular_hours_per_week REAL DEFAULT 40;
ALTER TABLE persons ADD COLUMN ot_threshold_hours_per_week REAL;
ALTER TABLE persons ADD COLUMN expected_bonus_frequency TEXT NOT NULL DEFAULT 'ANNUAL';
ALTER TABLE persons ADD COLUMN bonus_is_consistent INTEGER NOT NULL DEFAULT 1;
