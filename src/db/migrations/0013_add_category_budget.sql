-- 0013_add_category_budget.sql
-- Optional monthly budget target per category. NULL = no budget set.
ALTER TABLE categories ADD COLUMN monthly_budget REAL;
