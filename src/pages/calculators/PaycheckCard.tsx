import { useEffect, useMemo, useState } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { CalculatorCard, EmptyMeaning, RailViewGroup } from './CalculatorCard';
import { computePaycheck, FEDERAL_LIABILITY_CAVEAT } from '@/lib/calculators/paycheck';
import { aggregateHouseholdPretax } from '@/lib/calculators/supplemental-wage';
import { computeBonusTax } from '@/lib/tax';
import { formatCurrency } from '@/lib/format';
import { CONTRIBUTION_LIMITS_2026 } from '@/lib/contribution-limits';
import { PAYCHECK_PERIODS, periodsPerYear, type PaycheckPeriod } from '@/lib/paycheck-periods';
import { getCurrentTaxYear } from '@/lib/current-tax-year';
import { ResultRow } from '@/components/calculators/ResultRow';
import { NotModeledDisclosure } from '@/components/calculators/NotModeledDisclosure';
import { EarnerSelect } from '@/components/calculators/EarnerSelect';
import { useSelectedEarner } from '@/lib/calculators/use-selected-earner';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { InlineLink } from '@/components/calculators/InlineLink';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

interface PaycheckCardProps {
  cardId?: string;
}

export function PaycheckCard({ cardId }: PaycheckCardProps = {}) {
  const { household } = useHouseholdStore();
  const persons = usePersonsStore((s) => s.persons);
  const dependents = useDependentsStore((s) => s.dependents);
  const taxItems = useTaxRulesStore((s) => s.items);
  const [period, setPeriod] = useState<PaycheckPeriod>('MONTHLY');
  // D16 (Wave 18): Combined | per-person view. null = Combined (the default);
  // a person id switches the breakdown grid to that person's marginal
  // attribution. View-only — never sets isOverridden.
  const personIds = useMemo(
    () => persons.map((p) => p.id).filter((id): id is number => id != null),
    [persons],
  );
  const [selectedId, setSelectedId] = useSelectedEarner(cardId ?? 'paycheck', null, personIds);

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

  // D16 (Wave 18): the per-person view's tax rows are MARGINAL attribution via
  // the engine's existing with/without diff — computeBonusTax with the OTHER
  // earners' wages as the base and {name}'s salary as the "bonus" yields the
  // incremental tax attributable to that salary stacked on the household.
  // Never a fabricated proportional split: joint brackets are shared, and this
  // is the one figure the engine actually computes. FICA is exact under the
  // Wave-9 per-earner wage-base split (recipientIndex).
  const personIdx = selectedId != null ? persons.findIndex((p) => p.id === selectedId) : -1;
  const personMarginal = useMemo(() => {
    if (selectedId == null || personIdx < 0 || !household || taxItems.length === 0) return null;
    const federal = lookup('FEDERAL', 'US', household.filingStatus);
    const state = lookup('STATE', household.state, household.filingStatus);
    const city = household.city ? lookup('CITY', household.city, household.filingStatus) : null;
    if (!federal || !state) return null;
    const person = persons[personIdx];
    const others = persons.filter((_, i) => i !== personIdx);
    // Household-wide counts (the aggregateHouseholdPretax contract) — the
    // per-return DCFSA/HSA caps don't shrink because we sum a subset.
    const othersAgg = aggregateHouseholdPretax(others, {
      filingStatus: household.filingStatus,
      personCount: persons.length,
      dependentCount: dependents.length,
    });
    return computeBonusTax({
      personGross: othersAgg.totalSalary + person.annualSalaryPretax,
      bonus: person.annualSalaryPretax, // the "with/without {name}'s salary" diff
      pretax: othersAgg.pretax, // others' pretax rides in both legs
      filingStatus: household.filingStatus,
      federalBrackets: federal.brackets,
      stateBrackets: state.brackets,
      cityBrackets: city?.brackets ?? null,
      standardDeduction: {
        federal: federal.standardDeduction,
        state: state.standardDeduction,
        city: city?.standardDeduction ?? 0,
      },
      perPersonBaseGross: persons.map((p, i) => (i === personIdx ? 0 : p.annualSalaryPretax)),
      recipientIndex: personIdx, // exact per-earner FICA (Wave-9 wage-base split)
    });
  }, [selectedId, personIdx, persons, household, dependents, taxItems, resolvedYear]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!annual) {
    return (
      <CalculatorCard
        title="Paycheck (estimated take-home)"
        headline="—"
        cardId={cardId}
        meaning={
          <EmptyMeaning>
            <InlineLink to="/inputs/household">
              Set up your household profile
            </InlineLink>{' '}
            + tax rules to see take-home.
          </EmptyMeaning>
        }
      />
    );
  }

  // Wave 15 review: the headline sums annualSalaryPretax, and HOURLY persons
  // persist annualSalaryPretax = 0 (their pay isn't salary) — as do
  // non-earning household members. Count only the people whose pay is
  // actually in the number, or "N earners, combined" is a false sentence.
  const salariedEarnerCount = persons.filter((p) => p.annualSalaryPretax > 0).length;

  const div = periodsPerYear(period);
  // D16: per-person view figures — {name}'s own gross + pre-tax elections are
  // EXACT (that person's own §402(g) cap, own health/DCFSA/HSA elections — not
  // the household per-return caps); the tax rows are the marginal attribution
  // computed above. The headline stays the Combined take-home in both views.
  const selectedPerson =
    personIdx >= 0 && personMarginal != null ? persons[personIdx] : null;
  const own = selectedPerson
    ? {
        gross: selectedPerson.annualSalaryPretax / div,
        pretax401k:
          Math.min(
            selectedPerson.annualSalaryPretax * selectedPerson.pretax401kPct,
            CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K,
          ) / div,
        pretaxHealth: (selectedPerson.healthInsuranceMonthlyPremium * 12) / div,
        pretaxDcfsa: (selectedPerson.dependentCareFsaMonthly * 12) / div,
        pretaxHsa:
          (selectedPerson.hsaEligible ? selectedPerson.hsaMonthlyContribution * 12 : 0) / div,
        federal: personMarginal!.bonusBreakdown.federal / div,
        fica: personMarginal!.bonusBreakdown.fica / div,
        stateTax: personMarginal!.bonusBreakdown.state / div,
        cityTax: personMarginal!.bonusBreakdown.city / div,
      }
    : null;
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
      meaning={<>After taxes and pretax deductions on {formatCurrency(perPeriod.gross)} gross.</>}
      rail={
        <RailViewGroup>
          {/* D16: Combined | per-person — renders nothing for single-earner
              households (EarnerSelect's <2 rule). */}
          <EarnerSelect
            persons={persons}
            selectedId={selectedId}
            onChange={setSelectedId}
            label="Paycheck view"
            includeCombined
          />
          <div className="space-y-1">
            <Label htmlFor="paycheck-period">Period</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as PaycheckPeriod)}>
              <SelectTrigger id="paycheck-period" aria-label="Period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYCHECK_PERIODS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </RailViewGroup>
      }
      headline={
        // Wave 15 T1: period unit + earner qualifier live in the HEADLINE node
        // so a collapsed card is never ambiguous — CalculatorCard hides
        // children when collapsed, not the headline.
        <span data-testid="paycheck-takehome">
          {formatCurrency(perPeriod.takeHome)}
          <span className="text-base font-medium">
            {' '}/ {PAYCHECK_PERIODS.find((p) => p.id === period)?.label.toLowerCase() ?? 'period'}
          </span>
          {salariedEarnerCount > 1 && (
            <span className="block text-xs font-normal text-muted-foreground">
              {salariedEarnerCount} earners, combined
              {salariedEarnerCount < persons.length && ' — salary only'}
            </span>
          )}
        </span>
      }
    >
      <div className="mb-3">
        <InlineLink
          to="/calculators/paycheck"
          className="text-sm"
        >
          Open full calculator →
        </InlineLink>
      </div>
      {own && selectedPerson ? (
        <>
          {/* D16 per-person view: exact own gross/pre-tax, marginal tax rows. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <ResultRow
              label={`${selectedPerson.name}'s gross`}
              value={formatCurrency(own.gross)}
            />
            <ResultRow
              label={<TermTooltip term="Pretax 401(k)" />}
              value={formatCurrency(own.pretax401k)}
            />
            <ResultRow label="Pretax health" value={formatCurrency(own.pretaxHealth)} />
            <ResultRow
              label={<TermTooltip term="Pretax DCFSA" />}
              value={formatCurrency(own.pretaxDcfsa)}
            />
            <ResultRow
              label={<TermTooltip term="Pretax HSA" />}
              value={formatCurrency(own.pretaxHsa)}
            />
            <ResultRow
              label={
                <span>
                  Estimated federal tax
                  <span className="block text-[11px] text-muted-foreground">
                    {FEDERAL_LIABILITY_CAVEAT}
                  </span>
                </span>
              }
              value={formatCurrency(own.federal)}
            />
            <ResultRow
              label={<TermTooltip term="FICA" />}
              value={formatCurrency(own.fica)}
            />
            <ResultRow label="Estimated state tax" value={formatCurrency(own.stateTax)} />
            <ResultRow label="Estimated city tax" value={formatCurrency(own.cityTax)} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Tax rows are the marginal share attributed to {selectedPerson.name}&#39;s pay —
            joint brackets are shared, so the split is an estimate.
          </p>
        </>
      ) : (
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
      )}
      {/* Wave-5 W5-5 — calculator framing parity with the 401k card.
          The take-home headline is an estimate because this engine omits
          items that materially shift the real number. List them so the user
          knows what isn't included. */}
      <NotModeledDisclosure
        intro={`Social Security wage base — OASDI stops at $${CONTRIBUTION_LIMITS_2026.SOCIAL_SECURITY_WAGE_BASE.toLocaleString('en-US')} per person (2026); the calculator applies the cap per earner.`}
        footer="For an actual reconciliation, compare against a real pay stub or run the numbers past a CPA — the items above can each shift the bottom line by tens or hundreds of dollars per period."
      >
          <li>
            Hourly wages — this card sums annual salaries, so an hourly
            earner's pay is not included here (see the Overtime card for
            hourly OT take-home).
          </li>
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
      </NotModeledDisclosure>
    </CalculatorCard>
  );
}
