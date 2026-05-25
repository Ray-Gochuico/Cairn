import { z } from 'zod';
import type {
  Household,
  Person,
  Account,
  Loan,
  Contribution,
  AccountSnapshot,
  Transaction,
} from './schema';

/**
 * Stable node identifier — never renamed once a release ships. Acts
 * as the foreign key in roadmap_node_overrides and is referenced from
 * NodeRow prerequisites + the user-facing override dialog.
 */
export type NodeId = string;

export const NodeStatusSchema = z.enum([
  'done',
  'active',
  'unanswered',
  'not-started',
  'skipped',
  'info',
]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const OverrideStatusSchema = z.enum(['done', 'not-started', 'skipped']);
export type OverrideStatus = z.infer<typeof OverrideStatusSchema>;

export type NodeKind = 'action' | 'decision' | 'info';

export interface NodeQuestion {
  prompt: string;
  answerType: 'yes-no' | 'enum';
  options?: { value: string; label: string }[];
  onAnswer: (value: string) => Promise<void>;
}

export interface NodeCta {
  label: string;
  href: string;
}

export interface NodeResult {
  status: NodeStatus;
  evidence?: string;
  cta?: NodeCta;
  question?: NodeQuestion;
  /**
   * When a user overrides this node, the engine writes the displayed
   * status from the override and keeps the original auto result on this
   * side channel so the detail drawer can show both.
   */
  autoResult?: Omit<NodeResult, 'autoResult'>;
}

export interface RoadmapNodeOverride {
  id: number;
  householdId: number;
  nodeId: NodeId;
  overrideStatus: OverrideStatus;
  note: string | null;
  setAt: string;
}

/**
 * Read-only snapshot of everything the rule engine reads to compute a
 * status. Assembled fresh by `useRoadmap()` whenever any backing store
 * changes; rules treat this as immutable.
 */
export interface RoadmapContext {
  household: Household;
  persons: Person[];
  accounts: Account[];
  loans: Loan[];
  contributions: Contribution[];
  snapshots: AccountSnapshot[];
  /**
   * Transactions from the spending pipeline (Phase 4). Rules that need
   * to detect "is the user actively tracking expenses?" read this; an
   * empty array means tracking is not happening, not that the user has
   * zero spending. Most rules will ignore this field entirely.
   */
  transactions: Transaction[];
  overrides: Map<NodeId, RoadmapNodeOverride>;
  thresholds: { low: number; high: number };
  taxYear: 2026;
  today: Date;
}

export interface RoadmapNode {
  id: NodeId;
  section: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  kind: NodeKind;
  title: string;
  /** Short markdown excerpt; longer body lives in the spec / chart md. */
  body: string;
  prerequisites: NodeId[];
  evaluate: (ctx: RoadmapContext) => NodeResult;
}
