import { Topic } from '@/types/enums';

/**
 * RATCHETED per-topic coverage floors (plan L2.3; gen spec §4).
 *
 * Each entry is the minimum number of REVIEWED questions the bank must hold for
 * that topic at each difficulty. Floors START at the backfilled-60 counts and
 * are raised ONE BATCH AT A TIME as the authoring loop approves content (the
 * approve-batch commit raises that topic's floor in the same commit). They are
 * never allowed to exceed what is approved, so the harness is always green
 * against what's shipped — but a regression (deleting or un-reviewing approved
 * content) drops a count below its floor and reds the suite.
 *
 * The FINAL targets (≈300 Beginner + 300 Advanced, deliberately non-uniform —
 * high-liability topics get SMALLER floors because human review is the
 * throughput bottleneck) live in the generation spec §4 as the definition-of-
 * done, NOT here. This table reflects what is approved *so far*.
 *
 * Current values = exact reviewed counts in bank-v1.json after the L3.3a
 * backfill (60 rows) plus the first two approved seed batches (23 rows):
 *   Taxes/Beginner: 11 → 23  (seed batch 1, user sign-off 2026-06-01)
 *   Investments/Advanced: 1 → 12  (seed batch 2, user sign-off 2026-06-01)
 * Total: 83 reviewed questions (52 Beginner / 31 Advanced).
 */
export const COVERAGE_FLOORS: Record<Topic, { Beginner: number; Advanced: number }> = {
  [Topic.FOUNDATIONS]: { Beginner: 7, Advanced: 0 },
  [Topic.BUDGETING]: { Beginner: 0, Advanced: 0 },
  [Topic.SAVINGS]: { Beginner: 1, Advanced: 0 },
  [Topic.SPENDING]: { Beginner: 0, Advanced: 0 },
  [Topic.CREDIT_DEBT]: { Beginner: 1, Advanced: 0 },
  [Topic.INVESTMENTS]: { Beginner: 2, Advanced: 12 },
  [Topic.RETIREMENT]: { Beginner: 9, Advanced: 9 },
  [Topic.INSURANCE]: { Beginner: 3, Advanced: 1 },
  [Topic.TAXES]: { Beginner: 23, Advanced: 5 },
  [Topic.JOB]: { Beginner: 4, Advanced: 1 },
  [Topic.HOME]: { Beginner: 0, Advanced: 0 },
  [Topic.LIFE_EVENTS]: { Beginner: 2, Advanced: 1 },
  [Topic.DEATH]: { Beginner: 0, Advanced: 2 },
};
