import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { CalculatorCard } from './CalculatorCard';
import { computePaycheck, FEDERAL_LIABILITY_CAVEAT } from '@/lib/calculators/paycheck';
import { aggregateHouseholdPretax } from '@/lib/calculators/supplemental-wage';
import { formatCurrency } from '@/lib/format';
import { CONTRIBUTION_LIMITS_2026 } from '@/lib/contribution-limits';
import { PAYCHECK_PERIODS, periodsPerYear, type PaycheckPeriod } from '@/lib/paycheck-periods';
import { getCurrentTaxYear } from '@/lib/current-tax-year';
import { ResultRow } from '@/components/calculators/ResultRow';
import { TermTooltip } from '@/components/ui/glossary-tooltip';

interface PaycheckCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
}

export function PaycheckCard({ cardId, onHide }: PaycheckCardProps = {}) {
  const { household } = useHouseholdStore();
  const persons = usePersonsStore((s) => s.persons);
  const dependents = useDependentsStore((s) => s.dependents);
  const taxItems = useTaxRulesStore((s) => s.items);
  const [period, setPeriod] = useState<PaycheckPeriod>('MONTHLY');

  // Smart-resolve the tax year from the seeded set: if the current calendar year
  // has rules use it, otherwise fall back to the most-recent seeded year.
  const seededYears = useMemo(
    () => [...new Set(taxItems.map((r) => r.year))],
    [taxItems],
  );
  const { year: resolvedYear } = getCurrentTaxYear(seededYears);

  // Bootstrap: on mount, discover what years are seeded and load the most
  // recent. This avoids the trap where loadYear(currentCalendarYear) returns
  // empty and clobbers any pre-loaded fallback rules — the resolver above
  // will then map seededYears → resolvedYear correctly.
  useEffect(() => {
    useTaxRulesStore.getState().loadAvailableYears();
  }, []);

  const lookup = (jt: 'FEDERAL' | 'STATE' | 'CITY', code: string, fs: string) =>
    taxItems.find(
      (r) =>
        r.year === resolvedYear &&
        r.jurisdictionType === jt &&
        r.jurisdictionCode === code &&
        r.filingStatus === fs,
    ) ?? null;

  const annual = useMemo(() => {
    if (!household || persons.length === 0 || taxItems.length === 0) return null;
    const federal = lookup('FEDERAL', 'US', household.filingStatus);
    const state = lookup('STATE', household.state, household.filingStatus);
    const city = household.city ? lookup('CITY', household.city, household.filingStatus) : null;
    if (!federal || !state) return null;

    // Wave 15 Task 1 (D1): the card is a SUMMARY of the same engine the full
    // page runs — computePaycheck composes computeTotalTax + per-earner FICA +
    // take-home. Pretax still comes from the profile aggregate (per-return
    // caps, Round-3 M1: aggregateHouseholdPretax caps DCFSA/HSA once per
    // return and 401(k) per employee). totalSalary is SALARY ONLY — no bonus.
    const { totalSalary, pretax } = aggregateHouseholdPretax(persons, {
      filingStatus: household.filingStatus,
      personCount: persons.length,
      dependentCount: dependents.length,
    });
    return computePaycheck({
      gross: totalSalary,
      // Wave-9 F1: per-earner SS wage bases.
      perPersonGross: persons.map((p) => p.annualSalaryPretax),
      filingStatus: household.filingStatus,
      federalBrackets: federal.brackets,
      stateBrackets: state.brackets,
      cityBrackets: city?.brackets ?? null,
      // R3 wiring-sweep: per-jurisdiction SD (pre-fix: scalar federal SD
      // was applied to state/city tax too — MA-MFJ ~$1,610/yr under-collection).
      standardDeduction: {
        federal: federal.standardDeduction,
        state: state.standardDeduction,
        city: city?.standardDeduction ?? 0,
      },
      pretax,
    });
  }, [household, persons, dependents, taxItems, resolvedYear]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!annual) {
    return (
      <CalculatorCard
        title="Paycheck (estimated take-home)"
        headline="—"
        cardId={cardId}
        onHide={onHide}
      >
        <p className="text-sm text-muted-foreground">
          Set up your household profile + tax rules to see take-home.
        </p>
      </CalculatorCard>
    );
  }

  const div = periodsPerYear(period);
  const perPeriod = {
    gross: annual.gross / div,
    pretax401k: annual.pretax401k / div,
    pretaxHealth: annual.pretaxHealth / div,
    pretaxDcfsa: annual.pretaxDcfsa / div,
    pretaxHsa: annual.pretaxHsa / div,
    federal: annual.federal / div,
    fica: annual.fica / div,
    stateTax: annual.stateTax / div,
    cityTax: annual.cityTax / div,
    takeHome: annual.takeHome / div,
  };

  return (
    <CalculatorCard
      title="Paycheck (estimated take-home)"
      cardId={cardId}
      onHide={onHide}
      headline={
        // Wave 15 T1: period unit + earner qualifier live in the HEADLINE node
        // so a collapsed card is never ambiguous — CalculatorCard hides
        // children when collapsed, not the headline.
        <span data-testid="paycheck-takehome">
          {formatCurrency(perPeriod.takeHome)}
          <span className="text-base font-medium">
            {' '}/ {PAYCHECK_PERIODS.find((p) => p.id === period)?.label.toLowerCase() ?? 'period'}
          </span>
          {persons.length > 1 && (
            <span className="block text-xs font-normal text-muted-foreground">
              {persons.length} earners, combined
            </span>
          )}
        </span>
      }
    >
      <div className="flex items-center gap-2 mb-3 text-sm">
        <label htmlFor="paycheck-period" className="text-muted-foreground">
          Period:
        </label>
        <select
          id="paycheck-period"
          value={period}
          onChange={(e) => setPeriod(e.target.value as PaycheckPeriod)}
          className="border rounded px-2 py-1 bg-background"
        >
          {PAYCHECK_PERIODS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-3">
        <Link
          to="/calculators/paycheck"
          className="text-sm text-primary underline underline-offset-4 hover:text-primary/80"
        >
          Open full calculator →
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <ResultRow label="Gross" value={formatCurrency(perPeriod.gross)} />
        <ResultRow
          label={<TermTooltip term="Pretax 401(k)" />}
          value={formatCurrency(perPeriod.pretax401k)}
        />
        <ResultRow label="Pretax health" value={formatCurrency(perPeriod.pretaxHealth)} />
        <ResultRow
          label={<TermTooltip term="Pretax DCFSA" />}
          value={formatCurrency(perPeriod.pretaxDcfsa)}
        />
        <ResultRow
          label={<TermTooltip term="Pretax HSA" />}
          value={formatCurrency(perPeriod.pretaxHsa)}
        />
        {/* Wave 15 T1: the shared withholding-vs-liability caveat — one
            exported constant, so the two surfaces cannot drift in wording. */}
        <ResultRow
          label={
            <span>
              Estimated federal tax
              <span className="block text-[11px] text-muted-foreground">
                {FEDERAL_LIABILITY_CAVEAT}
              </span>
            </span>
          }
          value={formatCurrency(perPeriod.federal)}
        />
        <ResultRow
          label={<TermTooltip term="FICA" />}
          value={formatCurrency(perPeriod.fica)}
        />
        <ResultRow
          label="Estimated state tax"
          value={formatCurrency(perPeriod.stateTax)}
        />
        <ResultRow
          label="Estimated city tax"
          value={formatCurrency(perPeriod.cityTax)}
        />
      </div>
      {/* Wave-5 W5-5 — calculator framing parity with the 401k card.
          The take-home headline is an estimate because this engine omits
          items that materially shift the real number. List them so the user
          knows what isn't included. */}
      <details className="text-xs mt-3 border-t pt-2 text-muted-foreground">
        <summary className="cursor-pointer font-medium hover:text-foreground">
          What this calculator does NOT model
        </summary>
        <p className="mt-2">
          {`Social Security wage base — OASDI stops at $${CONTRIBUTION_LIMITS_2026.SOCIAL_SECURITY_WAGE_BASE.toLocaleString('en-US')} per person (2026); the calculator applies the cap per earner.`}
        </p>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>
            <TermTooltip term="NIIT">NIIT</TermTooltip> (3.8% net investment
            income tax) — applies to investment income, not wages, so it&#39;s
            outside this estimate.
          </li>
          <li>
            <TermTooltip term="AMT">AMT</TermTooltip> on ISO exercises landing in
            the same period.
          </li>
          <li>
            State Disability Insurance (CA SDI, NJ SDI, NY DBL, HI TDI) and state
            PFML deductions (MA, WA, CO, etc.) — separate from FICA, withheld
            on top of state tax.
          </li>
          <li>
            Post-tax deductions (Roth 401k, union dues, garnishments) — these
            reduce take-home but the engine treats only pre-tax 401k / health /
            DCFSA / HSA.
          </li>
          <li>
            DCFSA / HSA mid-year contribution changes — the engine uses your
            current monthly election applied to the full year.
          </li>
          <li>
            W-4 4(c) extra-withholding line — if you ask your employer to
            withhold an extra $X per check, that's not reflected here.
          </li>
        </ul>
        <p className="mt-2">
          For an actual reconciliation, compare against a real pay
          stub or run the numbers past a CPA — the items above can each shift
          the bottom line by tens or hundreds of dollars per period.
        </p>
      </details>
    </CalculatorCard>
  );
}
