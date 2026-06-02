import { Topic } from '@/types/enums';

/**
 * RATCHETED per-topic coverage floors (plan L2.3; gen spec §4).
 *
 * Each entry is the minimum number of REVIEWED questions the bank must hold for
 * that topic at each difficulty. Floors are the exact reviewed counts after each
 * approved batch is promoted; a regression (deleting/un-reviewing approved content)
 * drops a count below its floor and reds the suite.
 *
 * Updated 2026-06-02: promoted the top-up wave — 93 breadth/mid questions
 * (spot-sampled, user sign-off) closing the bank to the 300 Beginner / 300 Advanced target.
 * Total reviewed now 600.
 */
export const COVERAGE_FLOORS: Record<Topic, { Beginner: number; Advanced: number }> = {
  [Topic.FOUNDATIONS]: { Beginner: 30, Advanced: 28 },
  [Topic.BUDGETING]: { Beginner: 25, Advanced: 27 },
  [Topic.SAVINGS]: { Beginner: 27, Advanced: 27 },
  [Topic.SPENDING]: { Beginner: 26, Advanced: 27 },
  [Topic.CREDIT_DEBT]: { Beginner: 16, Advanced: 16 },
  [Topic.INVESTMENTS]: { Beginner: 28, Advanced: 34 },
  [Topic.RETIREMENT]: { Beginner: 24, Advanced: 24 },
  [Topic.INSURANCE]: { Beginner: 17, Advanced: 16 },
  [Topic.TAXES]: { Beginner: 23, Advanced: 17 },
  [Topic.JOB]: { Beginner: 24, Advanced: 24 },
  [Topic.HOME]: { Beginner: 24, Advanced: 24 },
  [Topic.LIFE_EVENTS]: { Beginner: 24, Advanced: 24 },
  [Topic.DEATH]: { Beginner: 12, Advanced: 12 },
};
