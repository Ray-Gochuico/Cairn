-- 0007_add_account_margin.sql
-- Add allow_margin flag so accounts can opt into >100% target allocation
-- (e.g., margin accounts where leveraged positions push effective
-- exposure past 100% of cash basis). Defaults to 0 (off) for safety.

ALTER TABLE accounts ADD COLUMN allow_margin INTEGER NOT NULL DEFAULT 0;
