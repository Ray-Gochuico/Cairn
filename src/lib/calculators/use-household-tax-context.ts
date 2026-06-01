import { useEffect, useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { getCurrentTaxYear } from '@/lib/current-tax-year';
import { aggregateHouseholdPretax, type HouseholdPretax } from '@/lib/calculators/supplemental-wage';
import type { TaxRule, JurisdictionType } from '@/types/schema';

export interface HouseholdTaxContext {
  ready: boolean;
  resolvedYear: number | null;
  lookup: (jt: JurisdictionType, code: string, fs: string) => TaxRule | null;
  federal: TaxRule | null;
  state: TaxRule | null;
  city: TaxRule | null;
  totalSalary: number;
  aggregatedPretax: HouseholdPretax;
}

/**
 * The shared W-2 tax scaffolding the supplemental-wage cards used to copy-paste:
 * resolves the tax year from the seeded set, runs the one-time
 * `loadAvailableYears` bootstrap, and exposes a `resolvedYear`-aware `lookup`
 * plus the resolved federal/state/city rules and the all-persons salary/pretax
 * aggregate. Single source of truth — the v1.1 Paycheck calculator imports this.
 */
export function useHouseholdTaxContext(): HouseholdTaxContext {
  const { household } = useHouseholdStore();
  const persons = usePersonsStore((s) => s.persons);
  const dependents = useDependentsStore((s) => s.dependents);
  const taxItems = useTaxRulesStore((s) => s.items);

  const seededYears = useMemo(() => [...new Set(taxItems.map((r) => r.year))], [taxItems]);
  const { year: resolvedYear } = getCurrentTaxYear(seededYears);

  // Bootstrap: discover seeded years + load the most recent (idempotent), and
  // hydrate the persons/dependents this context aggregates. On a cold boot — or
  // a deep-link straight to a calculator route — no prior page has loaded them
  // (the Dashboard landing page loads 13 stores but NOT persons/dependents), so
  // without this the cards render their "add a person" empty-state despite real
  // data in the DB. (household loads globally via AppDisclaimerGate.)
  useEffect(() => {
    useTaxRulesStore.getState().loadAvailableYears();
    void usePersonsStore.getState().load();
    void useDependentsStore.getState().load();
  }, []);

  const lookup = (jt: JurisdictionType, code: string, fs: string): TaxRule | null =>
    taxItems.find(
      (r) =>
        r.year === resolvedYear &&
        r.jurisdictionType === jt &&
        r.jurisdictionCode === code &&
        r.filingStatus === fs,
    ) ?? null;

  const federal = household ? lookup('FEDERAL', 'US', household.filingStatus) : null;
  const state = household ? lookup('STATE', household.state, household.filingStatus) : null;
  const city = household?.city ? lookup('CITY', household.city, household.filingStatus) : null;

  const { totalSalary, aggregatedPretax } = useMemo(() => {
    if (!household || persons.length === 0) {
      return { totalSalary: 0, aggregatedPretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 } };
    }
    const agg = aggregateHouseholdPretax(persons, {
      filingStatus: household.filingStatus,
      personCount: persons.length,
      dependentCount: dependents.length,
    });
    return { totalSalary: agg.totalSalary, aggregatedPretax: agg.pretax };
  }, [household, persons, dependents]);

  const ready = !!household && persons.length > 0 && taxItems.length > 0 && !!federal && !!state;

  return { ready, resolvedYear, lookup, federal, state, city, totalSalary, aggregatedPretax };
}
