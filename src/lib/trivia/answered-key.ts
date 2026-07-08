/**
 * Canonical key for an answered question, version-aware. The learning_answers
 * grain is UNIQUE(question_id, question_version) (0037), so "have I answered
 * this?" must compare the CURRENT question's (id, version) — keying on id alone
 * would make question_version cosmetic and silently swallow the v1.2 re-prompt
 * after a content correction. Shared by LearningStateRepo.listAnsweredQuestionIds
 * (producer) and selectDailySet (consumer) so the format never drifts.
 */
export function answeredKey(questionId: string, questionVersion: number): string {
  return `${questionId}@v${questionVersion}`;
}
