-- 0052_interview_answers.sql
-- Durable guided-interview answers (design §1.2). One row per
-- (household, thread, question, subject) — the roadmap_node_overrides
-- upsert-in-place shape generalized with thread/question/subject
-- dimensions. Holds ONLY user preferences/facts the interview owns;
-- facts other engines read stay on their entities (write-through), and
-- computed replies are NEVER persisted.
--   value_json       — canonical JSON, Zod-validated on read AND write.
--   question_version — the node's version when answered; older stored
--                      versions re-ask (the disclosure_acceptances.version
--                      pattern applied to questions).
--   answered_at      — ISO timestamp; drives per-question age staleness.
--   basis_json       — the data-branch snapshot the answer sat on
--                      ({"branch": ..., ...facts}); a different branch on
--                      re-evaluation invalidates the answer.
CREATE TABLE IF NOT EXISTS interview_answers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id     INTEGER NOT NULL REFERENCES household(id),
  thread_id        TEXT NOT NULL,
  question_id      TEXT NOT NULL,
  subject_key      TEXT NOT NULL DEFAULT '',
  value_json       TEXT NOT NULL,
  question_version INTEGER NOT NULL,
  answered_at      TEXT NOT NULL,
  basis_json       TEXT,
  UNIQUE(household_id, thread_id, question_id, subject_key)
);
