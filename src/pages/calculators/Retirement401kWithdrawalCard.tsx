import { useEffect, useMemo, useState } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { CalculatorCard } from './CalculatorCard';
import { calculate401kWithdrawalTax } from '@/lib/tax';
import { getCurrentTaxYear } from '@/lib/current-tax-year';
import { formatCurrency, formatPercent } from '@/lib/format';
import { Input } from '@/components/ui/input';

interface Retirement401kWithdrawalCardProps {
  cardId?: string;
  onHide?: () => void;
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
  const [ageOverride, setAgeOverride] = useState<number | null>(null);
  const [planType, setPlanType] = useState<'TRADITIONAL' | 'ROTH'>('TRADITIONAL');

  const annualW2Income = w2Override ?? defaultW2;
  const ageAtWithdrawal = ageOverride ?? defaultAge;

  const lookup = (jt: 'FEDERAL' | 'STATE' | 'CITY', code: string, fs: string) =>
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

    return calculate401kWithdrawalTax({
      withdrawalAmount,
      annualW2Income,
      annualCapitalGains: capGains,
      ageAtWithdrawal,
      filingStatus: household.filingStatus,
      federalBrackets: federal.brackets,
      stateBrackets: state.brackets,
      cityBrackets: city?.brackets ?? null,
      federalStandardDeduction: federal.standardDeduction,
      taxYear: resolvedYear ?? new Date().getFullYear(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    household,
    taxItems,
    resolvedYear,
    withdrawalAmount,
    annualW2Income,
    capGains,
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
          <div className="flex justify-between">
            <span>FICA</span>
            <span className="tabular-nums text-muted-foreground">
              N/A on 401k withdrawals
            </span>
          </div>
          <div
            className={`flex justify-between ${
              earlyPenaltyApplies ? 'text-destructive' : ''
            }`}
          >
            <span>Early-withdrawal penalty (10% if &lt; 59½)</span>
            <span className="tabular-nums">
              {formatCurrency(breakdown.earlyWithdrawalPenalty)}
            </span>
          </div>
          <div className="flex justify-between font-medium border-t pt-1">
            <span>Total tax on withdrawal</span>
            <span className="tabular-nums">
              {formatCurrency(breakdown.totalTaxOnWithdrawal)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Net to user</span>
            <span className="tabular-nums font-medium">
              {formatCurrency(breakdown.netToUser)}
            </span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Effective rate on this withdrawal</span>
            <span className="tabular-nums">
              {formatPercent(breakdown.effectiveRate)}
            </span>
          </div>
        </div>
      )}
    </CalculatorCard>
  );
}
