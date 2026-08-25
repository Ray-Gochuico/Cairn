import type { Database } from '@/db/db';
import type { InterviewAnswer } from '@/types/interview';

interface InterviewAnswerRow {
  id: number;
  household_id: number;
  thread_id: string;
  question_id: string;
  subject_key: string;
  value_json: string;
  question_version: number;
  answered_at: string;
  basis_json: string | null;
}

function mapRow(r: InterviewAnswerRow): InterviewAnswer {
  return {
    id: r.id,
    householdId: r.household_id,
    threadId: r.thread_id,
    questionId: r.question_id,
    subjectKey: r.subject_key,
    valueJson: r.value_json,
    questionVersion: r.question_version,
    answeredAt: r.answered_at,
    basisJson: r.basis_json,
  };
}

/**
 * interview_answers persistence (design §1.2). Cloned from
 * RoadmapOverridesRepo: single-round-trip INSERT … ON CONFLICT DO UPDATE
 * upsert keyed by the UNIQUE(household, thread, question, subject), plus
 * a keyed delete for the "Ask me again" affordance (clearOverride pattern).
 */
export class InterviewAnswersRepo {
  constructor(private db: Database) {}

  async list(): Promise<InterviewAnswer[]> {
    const rows = await this.db.select<InterviewAnswerRow>(
      'SELECT * FROM interview_answers ORDER BY id',
    );
    return rows.map(mapRow);
  }

  async upsert(input: {
    householdId: number;
    threadId: string;
    questionId: string;
    subjectKey: string;
    valueJson: string;
    questionVersion: number;
    answeredAt: string;
    basisJson: string | null;
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO interview_answers
         (household_id, thread_id, question_id, subject_key, value_json, question_version, answered_at, basis_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(household_id, thread_id, question_id, subject_key) DO UPDATE SET
         value_json = excluded.value_json,
         question_version = excluded.question_version,
         answered_at = excluded.answered_at,
         basis_json = excluded.basis_json`,
      [
        input.householdId, input.threadId, input.questionId, input.subjectKey,
        input.valueJson, input.questionVersion, input.answeredAt, input.basisJson,
      ],
    );
  }

  async delete(
    householdId: number,
    threadId: string,
    questionId: string,
    subjectKey: string,
  ): Promise<void> {
    await this.db.execute(
      `DELETE FROM interview_answers
        WHERE household_id = ? AND thread_id = ? AND question_id = ? AND subject_key = ?`,
      [householdId, threadId, questionId, subjectKey],
    );
  }

  /** Entity-delete cascade (the AssetValueSnapshotsRepo.deleteForOwner
   * pattern): remove every answer keyed to one subject, across threads.
   * Household-agnostic on purpose — subject_key embeds the entity table's
   * unique id ('vehicle:<id>', see subjectsOf in domain/interview/evaluate),
   * and exact matching cannot cross-hit ('vehicle:1' ≠ 'vehicle:10'). */
  async deleteForSubject(subjectKey: string): Promise<void> {
    await this.db.execute('DELETE FROM interview_answers WHERE subject_key = ?', [subjectKey]);
  }
}
