-- 0037_learning_state.sql
-- Daily Trivia / Financial-Literacy Learning (v1.1, 2026-05-28).
--
-- This slot was intentionally reserved (see src/db/migrations.ts) for the
-- trivia feature. It adds exactly two tables and NO household columns:
--   1. learning_state — a strict singleton (exactly one row, id = 1) mirroring
--      app_settings (0014). Holds the difficulty preference, the streak count,
--      and the "today's question" anchor (last_shown_*). Seeded so
--      LearningStateRepo.get() always finds it.
--   2. learning_answers — an append-only history of answered questions, one
--      row per (question_id, question_version): the composite UNIQUE enforces
--      the one-shot rule PER VERSION — a same-version re-answer is a no-op,
--      while a content correction that bumps the version makes the question
--      answerable again (the v1.2 re-prompt; spec §4.1/§9.3). The daily
--      selector reads this to exclude already-answered (id, version) pairs.
--
-- NOTE (MF-1, 2026-05-28 mega-scorecard): an earlier draft added two
-- household cache columns for the `learning` disclosure. That was rejected in
-- favor of a normalized gate that reads the existing disclosure_acceptances
-- table (added 0017; document_id is unconstrained TEXT). So this migration
-- touches NO household table — see the table-driven gate refactor in the
-- trivia plan Task 10 / spec §9.

CREATE TABLE learning_state (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  difficulty_preference    TEXT NOT NULL DEFAULT 'Beginner'
                             CHECK (difficulty_preference IN ('Beginner','Advanced','Mixed')),
  last_shown_question_id   TEXT,
  last_shown_iso_date      TEXT,
  streak_count             INTEGER NOT NULL DEFAULT 0,
  last_answered_iso_date   TEXT,
  created_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO learning_state (id) VALUES (1);

CREATE TABLE learning_answers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id       TEXT NOT NULL,
  answered_iso_date TEXT NOT NULL,
  chosen_index      INTEGER NOT NULL,
  was_correct       INTEGER NOT NULL,
  question_version  INTEGER NOT NULL,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(question_id, question_version)
);
CREATE INDEX idx_learning_answers_date ON learning_answers(answered_iso_date);
