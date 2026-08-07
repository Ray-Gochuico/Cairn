// src/types/interview.ts — grown in Task 2; the row type lands with the repo.
export interface InterviewAnswer {
  id: number;
  householdId: number;
  threadId: string;
  questionId: string;
  subjectKey: string;
  valueJson: string;
  questionVersion: number;
  answeredAt: string; // ISO timestamp
  basisJson: string | null;
}
