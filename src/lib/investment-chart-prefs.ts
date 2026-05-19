// src/lib/investment-chart-prefs.ts
const STORAGE_KEY_ACCOUNTS = 'investment-chart-selected-accounts';
const STORAGE_KEY_GRANULARITY = 'investment-chart-granularity';

import type { Granularity } from './snapshot-bucketing';

/**
 * Returns the persisted set of account ids the user wants to see in the
 * Investments time-series chart. Returns null if no preference saved
 * (caller should default to "all eligible").
 */
export function getSelectedAccounts(): number[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACCOUNTS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'number')) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSelectedAccounts(ids: number[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_ACCOUNTS, JSON.stringify(ids));
  } catch {
    // localStorage unavailable; silently no-op
  }
}

export function getGranularity(): Granularity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GRANULARITY);
    if (raw === 'DAY' || raw === 'WEEK' || raw === 'MONTH' || raw === 'QUARTER' || raw === 'YEAR') return raw;
    return null;
  } catch {
    return null;
  }
}

export function setGranularity(g: Granularity): void {
  try {
    localStorage.setItem(STORAGE_KEY_GRANULARITY, g);
  } catch {
    // ignore
  }
}
