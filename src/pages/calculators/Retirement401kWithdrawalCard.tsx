import { useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { CalculatorCard } from './CalculatorCard';
import { calculate401kWithdrawalTax } from '@/lib/tax';
import { useHouseholdTaxContext } from '@/lib/calculators/use-household-tax-context';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
import { ResultRow } from '@/components/calculators/ResultRow';
import { StatTile } from '@/components/calculators/StatTile';
import { formatCurrency, formatPercent } from '@/lib/format';
import { TermTooltip } from '@/components/ui/glossary-tooltip';

interface Retirement401kWithdrawalCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
}

function yearsBetween(dobISO: string, todayISO: string): number {
  const dob = new Date(`${dobISO}T00:00:00Z`);
  const today = new Date(`${todayISO}T00:00:00Z`);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export function Retirement401kWithdrawalCard({
  cardId,
  onHide,
}: Retirement401kWithdrawalCardProps = {}) {
  const { household } = useHouseholdStore();
  const { persons } = usePersonsStore();
  // Shared W-2 tax scaffolding (resolved year + jurisdiction lookups + the
  // one-time loadAvailableYears bootstrap). Replaces the card's former
  // hand-rolled seededYears/getCurrentTaxYear/loadAvailableYears effect + local
  // lookup — same resolution logic, single source of truth.
  const { lookup, resolvedYear, federal, state, city } = useHouseholdTaxContext();

  // ── Real-data defaults (memoized from the stores) ──────────────────────────
  // Prefill exactly as before: W-2 = Σ persons.annualSalaryPretax, age from
  // persons[0].dateOfBirth (else 67); the remaining inputs start at 0. The kit
  // merges the user's session overrides on top (overrides win) and persists
  // every edit under calc-state:retirement-401k-withdrawal.
  const defaults = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    const defaultW2 = persons.reduce(
      (acc, p) => acc + (p.annualSalaryPretax ?? 0),
      0,
    );
    const defaultAge = persons[0]?.dateOfBirth
      ? yearsBetween(persons[0].dateOfBirth, todayISO)
      : 67;
    return {
      withdrawalAmount: 0,
      annualW2Income: defaultW2,
      capGains: 0,
      // Wave-5 NEW-W5-2: existing investment income (interest + non-qualified
      // dividends + passive rental) feeds the NIIT delta computation. The
      // 401k withdrawal itself isn't NII (IRC §1411(c)(5)) but the resulting
      // MAGI bump can newly trigger NIIT on this OTHER investment income.
      otherInvestmentIncome: 0,
      ageAtWithdrawal: defaultAge,
      planType: 'TRADITIONAL' as 'TRADITIONAL' | 'ROTH',
    };
  }, [persons]);

  const { values, setValue, reset, isOverridden } = useCalculatorState(
    cardId ?? 'retirement-401k-withdrawal',
    defaults,
  );

  const {
    withdrawalAmount,
    annualW2Income,
    capGains,
    otherInvestmentIncome,
    ageAtWithdrawal,
    planType,
  } = values;

  const breakdown = useMemo(() => {
    if (!household || !federal || !state) return null;
    // LTCG schedule lookup (post-0032). When seeded, capGains are taxed
    // at the LTCG schedule instead of ordinary brackets. Falls through to
    // legacy behavior (ordinary brackets) for older tax years.
    const ltcg = lookup('FEDERAL_LTCG', 'US', household.filingStatus);

    return calculate401kWithdrawalTax({
      withdrawalAmount,
      annualW2Income,
      annualCapitalGains: capGains,
      ageAtWithdrawal,
      filingStatus: household.filingStatus,
      federalBrackets: federal.brackets,
      stateBrackets: state.brackets,
      cityBrackets: city?.brackets ?? null,
      // R3 wiring-sweep: per-jurisdiction SD. The retired person's W-2
      // income flowing through state tax now correctly uses the state's
      // own SD instead of the federal SD.
      federalStandardDeduction: {
        federal: federal.standardDeduction,
        state: state.standardDeduction,
        city: city?.standardDeduction ?? 0,
      },
      taxYear: resolvedYear ?? new Date().getFullYear(),
      ltcgBrackets: ltcg?.brackets,
      existingInvestmentIncome: otherInvestmentIncome,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    household,
    federal,
    state,
    city,
    resolvedYear,
    withdrawalAmount,
    annualW2Income,
    capGains,
    otherInvestmentIncome,
    ageAtWithdrawal,
  ]);

  const earlyPenaltyApplies = ageAtWithdrawal < 59.5;

  const controls = (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <NumberField
          id="withdrawal-amount"
          label="Withdrawal amount"
          value={withdrawalAmount}
          onChange={(v) => setValue('withdrawalAmount', v ?? 0)}
          step="500"
          min={0}
        />
        <NumberField
          id="w2-income"
          label="Annual W-2 income"
          value={annualW2Income}
          onChange={(v) => setValue('annualW2Income', v ?? 0)}
          step="1000"
          min={0}
        />
        <NumberField
          id="cap-gains"
          label="Capital gains for the year"
          value={capGains}
          onChange={(v) => setValue('capGains', v ?? 0)}
          step="500"
          min={0}
        />
        <div className="space-y-1">
          <NumberField
            id="other-investment-income"
            label="Other investment income"
            value={otherInvestmentIncome}
            onChange={(v) => setValue('otherInvestmentIncome', v ?? 0)}
            step="500"
            min={0}
          />
          <p className="text-xs text-muted-foreground">
            Interest, non-qualified dividends, passive rental — for{' '}
            <TermTooltip term="NIIT" /> delta.
          </p>
        </div>
        <NumberField
          id="age-at-withdrawal"
          label="Age at withdrawal"
          value={ageAtWithdrawal}
          onChange={(v) => setValue('ageAtWithdrawal', v ?? 0)}
          step="1"
          min={18}
        />
        <div className="space-y-1 sm:col-span-2">
          <span className="text-sm font-medium">Plan type</span>
          <div className="flex gap-3 items-center text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="plan-type"
                value="TRADITIONAL"
                checked={planType === 'TRADITIONAL'}
                onChange={() => setValue('planType', 'TRADITIONAL')}
              />
              Traditional 401k
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="plan-type"
                value="ROTH"
                checked={planType === 'ROTH'}
                onChange={() => setValue('planType', 'ROTH')}
                aria-label="Roth 401k"
              />
              Roth 401k
            </label>
          </div>
        </div>
      </div>
      {isOverridden && (
        <button
          type="button"
          onClick={reset}
          className="text-sm text-primary hover:underline mb-3"
        >
          Reset to my data
        </button>
      )}
    </>
  );

  // Roth 401(k) distributions are modeled as tax-free (assumes a qualified
  // distribution: age 59½ + 5-year rule). The underlying engine has no Roth
  // mode, so we present a zeroed breakdown for the Roth plan type. The
  // tax-free caveat is disclosed in the What-If footnote + the ROTH 401(K)
  // glossary entry.
  const view = planType === 'ROTH' && breakdown
    ? {
        incrementalFederal: 0,
        incrementalState: 0,
        incrementalCity: 0,
        incrementalNiit: 0,
        earlyWithdrawalPenalty: 0,
        totalTaxOnWithdrawal: 0,
        netToUser: withdrawalAmount,
        effectiveRate: 0,
      }
    : breakdown;

  const headline = view ? formatCurrency(view.netToUser) : '—';

  return (
    <CalculatorCard
      cardId={cardId}
      title="401k withdrawal tax"
      headline={
        <span data-testid="401k-withdrawal-net">{headline}</span>
      }
      onHide={onHide}
    >
      {controls}
      {!breakdown && (
        <p className="text-sm text-muted-foreground">
          Set up your household profile + tax rules to see the 401k
          withdrawal breakdown.
        </p>
      )}
      {breakdown && (
        <div className="space-y-1 text-sm">
          <ResultRow
            orientation="inline"
            label="Withdrawal amount"
            value={formatCurrency(withdrawalAmount)}
          />
          <ResultRow
            orientation="inline"
            label="Federal tax on withdrawal"
            value={formatCurrency(view!.incrementalFederal)}
          />
          <ResultRow
            orientation="inline"
            label="State tax on withdrawal"
            value={formatCurrency(view!.incrementalState)}
          />
          <ResultRow
            orientation="inline"
            label="City tax on withdrawal"
            value={formatCurrency(view!.incrementalCity)}
          />
          <div data-testid="401k-withdrawal-niit-row">
            <ResultRow
              orientation="inline"
              label={<TermTooltip term="NIIT">NIIT delta</TermTooltip>}
              value={formatCurrency(view!.incrementalNiit)}
            />
          </div>
          <ResultRow
            orientation="inline"
            label={<TermTooltip term="FICA" />}
            value={
              <span className="text-muted-foreground">
                N/A on 401k withdrawals
              </span>
            }
          />
          <div
            data-testid="401k-penalty-row"
            className={earlyPenaltyApplies && planType !== 'ROTH' ? 'text-destructive' : undefined}
          >
            <ResultRow
              orientation="inline"
              label={
                <TermTooltip term="Early-withdrawal penalty">
                  Early-withdrawal penalty{planType !== 'ROTH' && ' (10% if < 59½)'}
                </TermTooltip>
              }
              value={formatCurrency(view!.earlyWithdrawalPenalty)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t pt-2 mt-1">
            <StatTile
              testId="summary-taxes-paid"
              label="Estimated total taxes"
              value={formatCurrency(view!.totalTaxOnWithdrawal)}
            />
            <StatTile
              testId="summary-net-to-you"
              label="Estimated net to you"
              value={formatCurrency(view!.netToUser)}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Effective rate on this withdrawal</span>
            <span className="tabular-nums">
              {formatPercent(view!.effectiveRate)}
            </span>
          </div>
          {/* Wave-3 Task 6 — calculator framing. The headline numbers are
              labelled "Estimated" because this calculator deliberately
              omits several tax items that materially shift the real-world
              outcome. List them here so a user thinking of acting on the
              number knows what they're not getting. Native <details> keeps
              the card compact by default; click to expand.

              Wave-5 NEW-W5-2 (2026-05-27): NIIT was added to the
              incremental-tax path via the "NIIT delta" line above (uses
              Other investment income input + filing-status threshold).
              Its bullet was removed from this list since it is now modeled. */}
          <details className="text-xs mt-2 border-t pt-2 text-muted-foreground">
            <summary className="cursor-pointer font-medium hover:text-foreground">
              What this calculator does NOT model
            </summary>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>
                <TermTooltip term="AMT">AMT</TermTooltip> (Alternative Minimum Tax) on
                ISO exercises landing in the same year as the withdrawal.
              </li>
              <li>
                State-specific retirement-income exemptions (PA fully excludes
                401k distributions; IL, MS, IA exclude most pension income).
                The state-tax line above applies your regular state brackets.
              </li>
              <li>
                Separation-at-55 / Rule of 55 exception (waives the 10% penalty
                if you left the job in the year you turn 55+).
              </li>
              <li>
                SEPP / Rule 72(t) substantially-equal periodic payments
                (alternative penalty waiver for under-59½ withdrawals).
              </li>
              <li>
                <TermTooltip term="RMD">RMD</TermTooltip>s at age 73+ (Required Minimum
                Distributions force pre-tax withdrawals on a schedule;
                this calculator only computes a single voluntary withdrawal).
              </li>
            </ul>
            <p className="mt-2">
              For an actual withdrawal decision, run the numbers past a CFP or
              tax professional — the items above can each shift the bottom line
              by several thousand dollars.
            </p>
          </details>
        </div>
      )}
    </CalculatorCard>
  );
}
