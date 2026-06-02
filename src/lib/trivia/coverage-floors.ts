import { Topic } from '@/types/enums';

/**
 * RATCHETED per-topic coverage floors (plan L2.3; gen spec §4).
 *
 * Each entry is the minimum number of REVIEWED questions the bank must hold for
 * that topic at each difficulty. Floors are the exact reviewed counts after each
 * approved batch is promoted; a regression (deleting/un-reviewing approved content)
 * drops a count below its floor and reds the suite.
 *
 * Updated 2026-06-02: promoted the Wave-1 (high-liability, 100% review) +
 * Wave-2 (breadth/mid, spot-sampled) batches — 424 questions, user sign-off.
 * Total reviewed now 507.
 */
export const COVERAGE_FLOORS: Record<Topic, { Beginner: number; Advanced: number }> = {
  [Topic.FOUNDATIONS]: { Beginner: 25, Advanced: 20 },
  [Topic.BUDGETING]: { Beginner: 19, Advanced: 20 },
  [Topic.SAVINGS]: { Beginner: 21, Advanced: 20 },
  [Topic.SPENDING]: { Beginner: 20, Advanced: 20 },
  [Topic.CREDIT_DEBT]: { Beginner: 16, Advanced: 16 },
  [Topic.INVESTMENTS]: { Beginner: 21, Advanced: 30 },
  [Topic.RETIREMENT]: { Beginner: 24, Advanced: 24 },
  [Topic.INSURANCE]: { Beginner: 17, Advanced: 16 },
  [Topic.TAXES]: { Beginner: 23, Advanced: 17 },
  [Topic.JOB]: { Beginner: 20, Advanced: 19 },
  [Topic.HOME]: { Beginner: 18, Advanced: 18 },
  [Topic.LIFE_EVENTS]: { Beginner: 20, Advanced: 19 },
  [Topic.DEATH]: { Beginner: 12, Advanced: 12 },
};
