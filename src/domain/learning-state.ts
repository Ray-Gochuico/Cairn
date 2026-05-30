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
    try {
      await this.db.execute(
        `INSERT INTO learning_answers (
          question_id, answered_iso_date, chosen_index, was_correct, question_version
        ) VALUES (?, ?, ?, ?, ?)`,
        [a.questionId, a.answeredIsoDate, a.chosenIndex, a.wasCorrect ? 1 : 0, a.questionVersion],
      );
    } catch (err) {
      // UNIQUE(question_id, question_version) hit = this exact version already
      // answered; one-shot-per-version rule, treat as no-op. A bumped version
      // (v1.2 correction) is a NEW (id, version) pair, so it is NOT swallowed —
      // it inserts a fresh row and the question re-prompts.
      if (String(err).includes('UNIQUE')) return;
      throw err;
    }
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

  async countAnswered(): Promise<number> {
    const rows = await this.db.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM learning_answers',
    );
    return rows[0]?.n ?? 0;
  }
}
