import { z } from 'zod';
import type {
  Vehicle, AssetValueSnapshot, AppSettings, Holding, Ticker,
} from './schema';
import type { RoadmapContext } from './roadmap';

// ── Persistence row (Task 1) ────────────────────────────────────────────────
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

// ── Kernel vocabulary ───────────────────────────────────────────────────────
export type ThreadId = string;
export type InterviewNodeId = string;
/** '' = household-global; 'vehicle:<id>' = per-vehicle instance. */
export type SubjectKey = string;
export type Cadence = 'one-time' | 'per-month';

export const answerKey = (t: ThreadId, q: InterviewNodeId, s: SubjectKey): string =>
  `${t}/${q}/${s}`;

/**
 * The interview reads EVERYTHING the roadmap reads, plus the stores its
 * threads need. Assembled once per render by useInterview() (Task 3);
 * every evaluate/compute below is pure over this snapshot — `today` is
 * injected (context.ts:22-25 discipline).
 */
export interface InterviewContext extends RoadmapContext {
  vehicles: Vehicle[];
  assetValueSnapshots: AssetValueSnapshot[];
  settings: AppSettings | null;
  holdings: Holding[];
  tickers: Ticker[];
  interviewAnswers: ReadonlyMap<string, InterviewAnswer>;
}

// ── Question graph (design §1.1) ────────────────────────────────────────────
/** Typed controls ONLY — no free text anywhere (owner constraint 1). */
export type AnswerSpec =
  | { kind: 'enum'; options: { value: string; label: string }[] }
  | { kind: 'amount'; maxDollars?: number }
  | { kind: 'amount-cadence' }; // the bar; session-only by convention (D-GI13)

export type StorageSpec =
  | { kind: 'interview-answer' }
  | { kind: 'session' } // hypotheticals; supplied per-evaluation, never persisted
  | {
      kind: 'entity-column'; // one-place-per-thing write-through (D-GI1)
      read: (ctx: InterviewContext, subject: SubjectKey) => unknown | null;
      write: (value: unknown, ctx: InterviewContext, subject: SubjectKey) => Promise<void>;
    };

export interface PreferenceNode {
  kind: 'preference';
  /** Stable forever — FK material in interview_answers. */
  id: InterviewNodeId;
  /** Bump on material rewording/branch change → stored older versions re-ask. */
  version: number;
  prompt: string | ((ctx: InterviewContext, subject: SubjectKey) => string);
  answer: AnswerSpec;
  /** Validates the STORED value on read and write (D-GI16). */
  valueSchema: z.ZodType<unknown>;
  /** Age staleness (re-confirm banner; reply still renders). */
  staleAfterMonths?: number;
  storage: StorageSpec;
  /** Canonical answer key → next node id. '*' matches any valid value. */
  branches: Record<string, InterviewNodeId>;
}

export interface DataBranchNode {
  kind: 'data-branch';
  id: InterviewNodeId;
  /** Pure predicate over app data; stores nothing. */
  evaluate: (
    ctx: InterviewContext,
    subject: SubjectKey,
  ) => { branch: string; facts: Record<string, unknown> };
  /** branch → next node id; null = the thread does not surface. */
  branches: Record<string, InterviewNodeId | null>;
}

/** Answers parsed along the walked path, keyed by question id. */
export type AnswerValues = ReadonlyMap<InterviewNodeId, unknown>;

export interface ReplyNode {
  kind: 'reply';
  id: InterviewNodeId;
  /** Terminal; computed live; NEVER persisted (owner constraint 8). */
  compute: (ctx: InterviewContext, answers: AnswerValues, subject: SubjectKey) => InterviewReply;
}

export type InterviewNode = PreferenceNode | DataBranchNode | ReplyNode;

export interface InterviewThread {
  /** Stable forever — FK material in interview_answers. */
  id: ThreadId;
  title: string;
  scope: 'household'; // v1: household only (design §8)
  /** Per-instance threads enumerate subjects from ctx. */
  subject?: { kind: 'vehicle' };
  entry: InterviewNodeId;
  nodes: InterviewNode[];
}

// ── Replies (phase-1 vocabulary; FrameworkCardModel lives in lib) ───────────
export type InterviewReply =
  | { kind: 'framework-cards' } // the bar renders cards itself (Task 9)
  | { kind: 'plan'; title: string; lines: string[]; assumes: string[] }
  | { kind: 'info'; lines: string[] };

// ── Evaluation results ──────────────────────────────────────────────────────
export interface StoredAnswerView {
  value: unknown;
  questionVersion: number;
  /** null = session/entity answer (never age-stale). */
  answeredAt: string | null;
  basis: { branch: string } | null;
}

export type AskReason = 'unanswered' | 'version-changed' | 'basis-changed';

export interface ThreadEvaluationAsk {
  state: 'ask';
  node: PreferenceNode;
  subject: SubjectKey;
  reason: AskReason;
  /** Renderable prior answer for CI-36 (version-changed) — null otherwise. */
  priorAnswer: StoredAnswerView | null;
  /** Basis to pin (basis_json) when saving: the nearest upstream data-branch. */
  pinBasis: { branch: string; facts: Record<string, unknown> } | null;
}

export interface ThreadEvaluationReply {
  state: 'reply';
  node: ReplyNode;
  subject: SubjectKey;
  reply: InterviewReply;
  /** Every preference answered on the path — powers "Ask me again" (CI-35). */
  answeredPath: { node: PreferenceNode; answer: StoredAnswerView }[];
  /** Age-stale answers on the path — the CI-34 re-confirm banner. */
  staleAnswers: { node: PreferenceNode; answer: StoredAnswerView }[];
}

export type ThreadEvaluation =
  | { state: 'hidden' }
  | ThreadEvaluationAsk
  | ThreadEvaluationReply;
