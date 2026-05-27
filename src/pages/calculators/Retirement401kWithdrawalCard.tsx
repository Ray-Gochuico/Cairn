import { useEffect, useMemo, useState } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { CalculatorCard } from './CalculatorCard';
import { calculate401kWithdrawalTax } from '@/lib/tax';
import { getCurrentTaxYear } from '@/lib/current-tax-year';
import { formatCurrency, formatPercent } from '@/lib/format';
import { Input } from '@/components/ui/input';
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
  const taxItems = useTaxRulesStore((s) => s.items);

  const seededYears = useMemo(
    () => [...new Set(taxItems.map((r) => r.year))],
    [taxItems],
  );
  const { year: resolvedYear } = getCurrentTaxYear(seededYears);

  useEffect(() => {
    useTaxRulesStore.getState().loadAvailableYears();
  }, []);

  const todayISO = new Date().toISOString().slice(0, 10);
  const defaultW2 = persons.reduce(
    (acc, p) => acc + (p.annualSalaryPretax ?? 0),
    0,
  );
  const defaultAge = persons[0]?.dateOfBirth
    ? yearsBetween(persons[0].dateOfBirth, todayISO)
    : 67;

  const [withdrawalAmount, setWithdrawalAmount] = useState<number>(0);
  const [w2Override, setW2Override] = useState<number | null>(null);
  const [capGains, setCapGains] = useState<number>(0);
  // Wave-5 NEW-W5-2: existing investment income (interest + non-qualified
  // dividends + passive rental) feeds the NIIT delta computation. The
  // 401k withdrawal itself isn't NII (IRC §1411(c)(5)) but the resulting
  // MAGI bump can newly trigger NIIT on this OTHER investment income.
  const [otherInvestmentIncome, setOtherInvestmentIncome] = useState<number>(0);
  const [ageOverride, setAgeOverride] = useState<number | null>(null);
  const [planType, setPlanType] = useState<'TRADITIONAL' | 'ROTH'>('TRADITIONAL');

  const annualW2Income = w2Override ?? defaultW2;
  const ageAtWithdrawal = ageOverride ?? defaultAge;

  const lookup = (
    jt: 'FEDERAL' | 'FEDERAL_LTCG' | 'STATE' | 'CITY',
    code: string,
    fs: string,
  ) =>
    taxItems.find(
      (r) =>
        r.year === resolvedYear &&
        r.jurisdictionType === jt &&
        r.jurisdictionCode === code &&
        r.filingStatus === fs,
    ) ?? null;

  const breakdown = useMemo(() => {
    if (!household || taxItems.length === 0) return null;
    const federal = lookup('FEDERAL', 'US', household.filingStatus);
    const state = lookup('STATE', household.state, household.filingStatus);
    const city = household.city
      ? lookup('CITY', household.city, household.filingStatus)
      : null;
    if (!federal || !state) return null;
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
    taxItems,
    resolvedYear,
    withdrawalAmount,
    annualW2Income,
    capGains,
    otherInvestmentIncome,
    ageAtWithdrawal,
  ]);

  const earlyPenaltyApplies = ageAtWithdrawal < 59.5;

  const controls = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <div className="space-y-1">
        <label htmlFor="withdrawal-amount" className="text-sm font-medium">
          Withdrawal amount
        </label>
        <Input
          id="withdrawal-amount"
          type="number"
          min="0"
          step="500"
          value={withdrawalAmount}
          onChange={(e) =>
            setWithdrawalAmount(Math.max(0, Number(e.target.value)))
          }
          aria-label="Withdrawal amount"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="w2-income" className="text-sm font-medium">
          Annual W-2 income
        </label>
        <Input
          id="w2-income"
          type="number"
          min="0"
          step="1000"
          value={annualW2Income}
          onChange={(e) =>
            setW2Override(Math.max(0, Number(e.target.value)))
          }
          aria-label="Annual W-2 income"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="cap-gains" className="text-sm font-medium">
          Capital gains for the year
        </label>
        <Input
          id="cap-gains"
          type="number"
          min="0"
          step="500"
          value={capGains}
          onChange={(e) => setCapGains(Math.max(0, Number(e.target.value)))}
          aria-label="Capital gains for the year"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="other-investment-income" className="text-sm font-medium">
          Other investment income
        </label>
        <Input
          id="other-investment-income"
          type="number"
          min="0"
          step="500"
          value={otherInvestmentIncome}
          onChange={(e) =>
            setOtherInvestmentIncome(Math.max(0, Number(e.target.value)))
          }
          aria-label="Other investment income"
        />
        <p className="text-xs text-muted-foreground">
          Interest, non-qualified dividends, passive rental — for{' '}
          <TermTooltip term="NIIT" /> delta.
        </p>
      </div>
      <div className="space-y-1">
        <label htmlFor="age-at-withdrawal" className="text-sm font-medium">
          Age at withdrawal
        </label>
        <Input
          id="age-at-withdrawal"
          type="number"
          min="18"
          max="120"
          step="1"
          value={ageAtWithdrawal}
          onChange={(e) => setAgeOverride(Number(e.target.value))}
          aria-label="Age at withdrawal"
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <span className="text-sm font-medium">Plan type</span>
        <div className="flex gap-3 items-center text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="plan-type"
              value="TRADITIONAL"
              checked={planType === 'TRADITIONAL'}
              onChange={() => setPlanType('TRADITIONAL')}
            />
            Traditional 401k
          </label>
          <label
            className="flex items-center gap-1 text-muted-foreground"
            title="Roth distributions modeling coming in a future release"
          >
            <input
              type="radio"
              name="plan-type"
              value="ROTH"
              disabled
              aria-label="Roth 401k (coming soon)"
            />
            Roth 401k (coming soon)
          </label>
        </div>
      </div>
    </div>
  );

  const headline = breakdown ? formatCurrency(breakdown.netToUser) : '—';

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
          <div className="flex justify-between">
            <span>Withdrawal amount</span>
            <span className="tabular-nums">
              {formatCurrency(withdrawalAmount)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Federal tax on withdrawal</span>
            <span className="tabular-nums">
              {formatCurrency(breakdown.incrementalFederal)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>State tax on withdrawal</span>
            <span className="tabular-nums">
              {formatCurrency(breakdown.incrementalState)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>City tax on withdrawal</span>
            <span className="tabular-nums">
              {formatCurrency(breakdown.incrementalCity)}
            </span>
          </div>
          <div
            className="flex justify-between"
            data-testid="401k-withdrawal-niit-row"
          >
            <span>
              <TermTooltip term="NIIT">NIIT delta</TermTooltip>
            </span>
            <span className="tabular-nums">
              {formatCurrency(breakdown.incrementalNiit)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>
              <TermTooltip term="FICA" />
            </span>
            <span className="tabular-nums text-muted-foreground">
              N/A on 401k withdrawals
            </span>
          </div>
          <div
            className={`flex justify-between ${
              earlyPenaltyApplies ? 'text-destructive' : ''
            }`}
          >
            <span>
              <TermTooltip term="Early-withdrawal penalty">
                Early-withdrawal penalty (10% if &lt; 59½)
              </TermTooltip>
            </span>
            <span className="tabular-nums">
              {formatCurrency(breakdown.earlyWithdrawalPenalty)}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t pt-2 mt-1">
            <div
              data-summary-row="taxes-paid"
              className="rounded-md border bg-muted/30 px-3 py-2"
            >
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Estimated total taxes
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {formatCurrency(breakdown.totalTaxOnWithdrawal)}
              </div>
            </div>
            <div
              data-summary-row="net-to-you"
              className="rounded-md border bg-muted/30 px-3 py-2"
            >
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Estimated net to you
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {formatCurrency(breakdown.netToUser)}
              </div>
            </div>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Effective rate on this withdrawal</span>
            <span className="tabular-nums">
              {formatPercent(breakdown.effectiveRate)}
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
