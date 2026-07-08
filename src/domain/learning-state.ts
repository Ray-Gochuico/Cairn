import type { Database } from '@/db/db';
import {
  LearningStateSchema,
  type LearningState,
  type LearningAnswer,
} from '@/types/schema';
import { answeredKey } from '@/lib/trivia/answered-key';

interface LearningStateRow {
  id: number;
  difficulty_preference: string;
  last_shown_question_id: string | null;
  last_shown_iso_date: string | null;
  streak_count: number;
  last_answered_iso_date: string | null;
}

function rowToLearningState(row: LearningStateRow): LearningState {
  return LearningStateSchema.parse({
    id: 1,
    difficultyPreference: row.difficulty_preference,
    lastShownQuestionId: row.last_shown_question_id,
    lastShownIsoDate: row.last_shown_iso_date,
    streakCount: row.streak_count,
    lastAnsweredIsoDate: row.last_answered_iso_date,
  });
}

export class LearningStateRepo {
  constructor(private db: Database) {}

  async get(): Promise<LearningState> {
    const rows = await this.db.select<LearningStateRow>(
      'SELECT * FROM learning_state WHERE id = 1',
    );
    if (rows.length === 0) {
      throw new Error('learning_state singleton row missing — migration 0037 may not have run');
    }
    return rowToLearningState(rows[0]);
  }

  async update(patch: Partial<Omit<LearningState, 'id'>>): Promise<void> {
    const current = await this.get();
    const merged = { ...current, ...patch };
    LearningStateSchema.parse(merged);

    await this.db.execute(
      `UPDATE learning_state SET
        difficulty_preference = ?,
        last_shown_question_id = ?,
        last_shown_iso_date = ?,
        streak_count = ?,
        last_answered_iso_date = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [
        merged.difficultyPreference,
        merged.lastShownQuestionId,
        merged.lastShownIsoDate,
        merged.streakCount,
        merged.lastAnsweredIsoDate,
      ],
    );
  }

  async recordAnswer(a: Omit<LearningAnswer, 'id'>): Promise<void> {
    // INSERT OR IGNORE: a same-(question_id, question_version) re-answer hits
    // the composite UNIQUE and is skipped — the one-shot-per-version rule —
    // without string-matching driver error text. A bumped version (v1.2
    // correction) is a NEW pair, so it inserts and the question re-prompts.
    await this.db.execute(
      `INSERT OR IGNORE INTO learning_answers (
        question_id, answered_iso_date, chosen_index, was_correct, question_version
      ) VALUES (?, ?, ?, ?, ?)`,
      [a.questionId, a.answeredIsoDate, a.chosenIndex, a.wasCorrect ? 1 : 0, a.questionVersion],
    );
  }

  /**
   * The set of already-answered questions, keyed VERSION-AWARELY as
   * `answeredKey(question_id, question_version)` (e.g. `beg-apr@v1`). The daily
   * selector matches the CURRENT bank's (id, version) against this set, so a
   * question whose version was bumped after the user answered the old version
   * is NOT considered seen and re-prompts (the v1.2 correction path). A given
   * id can appear under multiple version keys; the selector only ever asks
   * about the current version, so that is correct.
   */
  async listAnsweredQuestionIds(): Promise<string[]> {
    const rows = await this.db.select<{ question_id: string; question_version: number }>(
      'SELECT question_id, question_version FROM learning_answers',
    );
    return rows.map((r) => answeredKey(r.question_id, r.question_version));
  }

  /** All-time participation + accuracy for the Learn header's progress line (Wave 8). */
  async answeredStats(): Promise<{ answered: number; correct: number }> {
    const rows = await this.db.select<{ n: number; c: number }>(
      'SELECT COUNT(*) AS n, COALESCE(SUM(was_correct), 0) AS c FROM learning_answers',
    );
    return { answered: rows[0]?.n ?? 0, correct: rows[0]?.c ?? 0 };
  }

  /**
   * DATE-AWARE answered keys for the derive anchor (L1.0 / §3.0). Partitions the
   * version-aware answered keys by `answered_iso_date` relative to `todayISO`:
   * `priorDays` are EXCLUDED from the day's 4-set (already done on an earlier
   * day) while `today` are KEPT in the set (just-answered, shown greyed) — which
   * is exactly the partition the derive model needs to stay stable under mid-day
   * answering. Reads `learning_answers.answered_iso_date` (a column present since
   * 0037), so it needs NO migration.
   *
   * `listAnsweredQuestionIds()` is kept for back-compat / other call sites; this
   * method is additive (a later cleanup may express the old one as priorDays ∪
   * today, but do not churn it here).
   *
   * `todayDetails` (Wave 8) powers the stepped-back graded reveal: the
   * chosen_index was persisted since 0037 but never read back until now, so a
   * later same-day visit can rehydrate exactly what the user picked.
   */
  async getAnsweredKeysByDay(
    todayISO: string,
  ): Promise<{ priorDays: string[]; today: string[]; todayDetails: Array<{ key: string; chosenIndex: number }> }> {
    const rows = await this.db.select<{
      question_id: string;
      question_version: number;
      answered_iso_date: string;
      chosen_index: number;
    }>('SELECT question_id, question_version, answered_iso_date, chosen_index FROM learning_answers');
    const key = (r: { question_id: string; question_version: number }) =>
      answeredKey(r.question_id, r.question_version);
    const todayRows = rows.filter((r) => r.answered_iso_date === todayISO);
    return {
      priorDays: rows.filter((r) => r.answered_iso_date !== todayISO).map(key),
      today: todayRows.map(key),
      todayDetails: todayRows.map((r) => ({ key: key(r), chosenIndex: r.chosen_index })),
    };
  }
}
