-- 0012_add_transaction_person.sql
-- Nullable link from a transaction to the household person it is attributed to.
-- NULL means joint / household-level (the convention shared by every other
-- person-scoped entity). Honored by the household / p1 / p2 / joint view filter.
ALTER TABLE transactions ADD COLUMN person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL;
