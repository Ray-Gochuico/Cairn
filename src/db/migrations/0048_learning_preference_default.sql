-- 0048_learning_preference_default.sql
-- Learn v3 (Wave 8, 2026-07-07): the difficulty preference returns to the UI
-- (Basics / Mix / Going deeper) with 'Mixed' as the product default — Mix is
-- exactly the 2 Beginner + 2 Advanced set v2 shipped. 0037 seeded the strict
-- singleton with the v1 default 'Beginner', which no user ever saw or set
-- after v2 removed the toggle, so an unconditional flip is honest. The column
-- CHECK (0037) already admits 'Mixed'; SQLite can't cheaply ALTER a column
-- default, and it doesn't matter: learning_state rows are only ever created
-- by 0037's seed, which this migration always follows.
UPDATE learning_state
SET difficulty_preference = 'Mixed', updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
