import { create } from 'zustand';
import { TaxRulesRepo } from '@/domain/tax-rules';
import { getDatabase } from '@/db/db';
import type { TaxRule, JurisdictionType } from '@/types/schema';
import type { FilingStatus } from '@/types/enums';

interface TaxRulesState {
  year: number | null;
  items: TaxRule[];
  isLoading: boolean;
  error: string | null;
  loadYear: (year: number) => Promise<void>;
  loadAvailableYears: () => Promise<void>;
  lookup: (jurisdictionType: JurisdictionType, code: string, filingStatus: FilingStatus) => TaxRule | null;
}

export const useTaxRulesStore = create<TaxRulesState>((set, get) => ({
  year: null,
  items: [],
  isLoading: false,
  error: null,

  async loadYear(year: number) {
    if (get().year === year && get().items.length > 0) return;
    set({ isLoading: true, error: null });
    try {
      const repo = new TaxRulesRepo(getDatabase());
      const items = await repo.listForYear(year);
      if (items.length === 0) {
        // No rules for the requested year — preserve the prior items so the
        // UI's getCurrentTaxYear() resolver can still fall back to the
        // most-recent seeded year. Just record the attempted year and clear
        // the loading flag.
        set({ year, isLoading: false });
      } else {
        set({ year, items, isLoading: false });
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isLoading: false });
    }
  },

  async loadAvailableYears() {
    try {
      const repo = new TaxRulesRepo(getDatabase());
      const years = await repo.listDistinctYears();
      if (years.length === 0) {
        set({ items: [], year: null });
        return;
      }
      // Pick the most-recent seeded year and load its full rule set so the
      // calculator cards always boot against real data — regardless of what
      // the calendar year happens to be.
      const mostRecent = Math.max(...years);
      await get().loadYear(mostRecent);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  lookup(jurisdictionType, code, filingStatus) {
    return (
      get().items.find(
        (r) =>
          r.year === get().year &&
          r.jurisdictionType === jurisdictionType &&
          r.jurisdictionCode === code &&
          r.filingStatus === filingStatus,
      ) ?? null
    );
  },
}));
