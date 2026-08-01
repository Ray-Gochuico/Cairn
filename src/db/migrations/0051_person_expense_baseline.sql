-- 0051_person_expense_baseline.sql
-- Durable per-person monthly expenses (the D-B7 follow-up decision, approved).
-- NULL = not set → scoped calculators keep the labeled even split of the
-- household baseline; a value = this person's own monthly expense share,
-- preferred by the person-scoped scenario bar with "from {name}'s Inputs"
-- provenance. Additive ADD COLUMN, nullable, no backfill — every existing
-- person stays on the even split until the owner sets a figure in Inputs.
ALTER TABLE persons ADD COLUMN monthly_expense_baseline REAL;
