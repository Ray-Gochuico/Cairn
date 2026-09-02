export * from './types';
export { blendedRealReturn, availableStartYears } from './data';
export { withdrawalForYear } from './strategies';
export { classifyTier, aggregate } from './aggregate';
export { backtestPlan, backtestPlanWithFlatReturn } from './engine';
export { DEFAULT_STOCK_PCT, datasetReplayRows, flatPathEnd, replayWindow, yearEnd } from './replay';
export type { ReplayRow, ReplayWindowInput, ReplayWindowResult, ReplayYearEnd } from './replay';
export { STRESS_WINDOWS } from './windows';
export type { StressWindow } from './windows';
