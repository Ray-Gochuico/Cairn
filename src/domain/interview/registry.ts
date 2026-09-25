import type { InterviewThread } from '@/types/interview';
import { NEXT_DOLLAR_THREAD } from './threads/next-dollar';
import { VEHICLE_REPLACEMENT_THREAD } from './threads/vehicle-replacement';
import { HOME_PURCHASE_THREAD } from './threads/home-purchase';
import { COLLEGE_VS_RETIREMENT_THREAD } from './threads/college-vs-retirement';
import { MARKET_STRESS_THREAD } from './threads/market-stress';

/**
 * Every shipped interview thread, in surface order (data-branch-triggered
 * threads surface before preference threads; within a group, registry
 * order — deterministic, design §4). Thread IDs are FK material — stable
 * forever, never renamed (the nodes.ts:80-83 discipline).
 * Phase 2 appended college_vs_retirement; R4 (v1.7.0) appended market_stress
 * LAST — the one planned unfreeze. The kernel API is frozen again after R4
 * (types/interview.ts AnswerSpec).
 */
export const INTERVIEW_THREADS: readonly InterviewThread[] = [
  NEXT_DOLLAR_THREAD,
  VEHICLE_REPLACEMENT_THREAD,
  HOME_PURCHASE_THREAD,
  COLLEGE_VS_RETIREMENT_THREAD,
  MARKET_STRESS_THREAD,
];
