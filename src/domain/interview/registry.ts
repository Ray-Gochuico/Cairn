import type { InterviewThread } from '@/types/interview';
import { NEXT_DOLLAR_THREAD } from './threads/next-dollar';
import { VEHICLE_REPLACEMENT_THREAD } from './threads/vehicle-replacement';

/**
 * Every shipped interview thread, in surface order (data-branch-triggered
 * threads surface before preference threads; within a group, registry
 * order — deterministic, design §4). Thread IDs are FK material — stable
 * forever, never renamed (the nodes.ts:80-83 discipline).
 * Phase 2 appends home_purchase and college_vs_retirement here — content
 * additions only; the kernel API is frozen at the Task-12 gate.
 */
export const INTERVIEW_THREADS: readonly InterviewThread[] = [
  NEXT_DOLLAR_THREAD,
  VEHICLE_REPLACEMENT_THREAD,
];
