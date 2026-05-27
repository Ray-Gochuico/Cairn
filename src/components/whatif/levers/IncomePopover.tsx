import { useEffect, useMemo, useState } from 'react';
import LeverPopoverShell from './LeverPopoverShell';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useScenariosStore } from '@/stores/scenarios-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { useLoansStore } from '@/stores/loans-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { incomeTrajectory } from '@/lib/whatif/income-trajectory';
import { formatCurrency } from '@/lib/format';
import { computeTotalTax } from '@/lib/tax';
import { taxBucketForAccount } from '@/lib/account-tax-classification';
import { monthlyExpenseFromPeriods } from '@/lib/scenarios/apply-real';
import { GapAllocationEditor } from './GapAllocationEditor';
import type {
  GapAllocation,
  PersonIncomePlan,
  IncomeEvent,
} from '@/lib/scenarios';
import type { Account } from '@/types/schema';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

type EventType = IncomeEvent['type'];
const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: 'raise',      label: 'Raise (one-off delta)' },
  { value: 'promotion',  label: 'Promotion (set new salary)' },
  { value: 'cut',        label: 'Cut (set lower salary)' },
  { value: 'job_change', label: 'Job change (set new salary)' },
  { value: 'sabbatical', label: 'Sabbatical (zero income N months)' },
];

function emptyEvent(): IncomeEvent {
  const today = new Date().toISOString().slice(0, 10);
  return { when: today, type: 'raise', deltaAmount: 0 };
}

function defaultPersonPlan(): PersonIncomePlan {
  return { annualRaiseRate: 0, events: [] };
}

export default function IncomePopover({ open, onOpenChange }: Props) {
  const scenarios = useScenariosStore((s) => s.scenarios);
  const persons = usePersonsStore((s) => s.persons);
  const household = useHouseholdStore((s) => s.household);
  const taxRules = useTaxRulesStore((s) => s.items);
  const loans = useLoansStore((s) => s.loans);
  const accounts = useAccountsStore((s) => s.accounts);
  const horizonMonths = useScenariosStore((s) => s.horizonMonths);
  const active = scenarios.find((s) => s.isActive);

  const personCount = Math.max(1, Math.min(2, persons.length || 1));
  const labels = personCount === 2 ? ['You', 'Partner'] : ['You'];

  const [draft, setDraft] = useState<PersonIncomePlan[]>(() =>
    Array.from({ length: personCount }, (_, i) =>
      active?.leverPayload.income.perPerson[i] ?? defaultPersonPlan(),
    ),
  );
  const [tab, setTab] = useState(0);

  useEffect(() => {
    if (open) {
      setDraft(
        Array.from({ length: personCount }, (_, i) =>
          active?.leverPayload.income.perPerson[i] ?? defaultPersonPlan(),
        ),
      );
      setTab(0);
    }
  }, [open, active?.leverPayload, personCount]);

  const plan = draft[tab] ?? defaultPersonPlan();
  const personSalary = persons[tab]?.annualSalaryPretax ?? 0;

  // -----------------------------------------------------------------
  // Per-person + household after-tax summary (revamp 2026-05-26).
  // Mirrors the engine's monthly-income calculation: take annualSalaryPretax
  // through computeTotalTax with the household's filingStatus + brackets,
  // then divide by 12.
  // -----------------------------------------------------------------
  const perPersonAfterTaxMonthly = useMemo(() => {
    if (!household) return [] as number[];
    const filingStatus = (household as { filingStatus: 'SINGLE' | 'MFJ' | 'MFS' | 'HOH' }).filingStatus;
    const state = (household as { state?: string | null }).state ?? null;
    const city  = (household as { city?: string | null }).city ?? null;
    const fedRule = taxRules.find((r) =>
      r.jurisdictionType === 'FEDERAL' && r.filingStatus === filingStatus,
    );
    const federalBrackets = fedRule?.brackets ?? [];
    const stateBrackets = state
      ? (taxRules.find((r) =>
          r.jurisdictionType === 'STATE' && r.jurisdictionCode === state && r.filingStatus === filingStatus,
        )?.brackets ?? [])
      : [];
    const cityBrackets = city
      ? (taxRules.find((r) =>
          r.jurisdictionType === 'CITY' && r.jurisdictionCode === city && r.filingStatus === filingStatus,
        )?.brackets ?? null)
      : null;
    const stdDed = fedRule?.standardDeduction ?? 0;

    return Array.from({ length: personCount }, (_, idx) => {
      const annual = persons[idx]?.annualSalaryPretax ?? 0;
      if (annual <= 0) return 0;
      const tax = computeTotalTax({
        gross: annual,
        filingStatus,
        federalBrackets,
        stateBrackets,
        cityBrackets,
        standardDeduction: stdDed,
        pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
      });
      return (annual - tax.total) / 12;
    });
  }, [household, persons, taxRules, personCount]);

  const householdAfterTaxMonthly = useMemo(
    () => perPersonAfterTaxMonthly.reduce((a, b) => a + b, 0),
    [perPersonAfterTaxMonthly],
  );

  const todayMonthISO = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const currentExpensesMonthly = useMemo(() => {
    return monthlyExpenseFromPeriods(active?.leverPayload.expensePeriods ?? [], todayMonthISO);
  }, [active?.leverPayload.expensePeriods, todayMonthISO]);

  const currentLoansMonthly = useMemo(
    () => loans.reduce((sum, l) => sum + (l.currentBalance > 0 ? l.monthlyPayment : 0), 0),
    [loans],
  );

  const rawGap = householdAfterTaxMonthly - currentExpensesMonthly - currentLoansMonthly;
  const gap = Math.max(0, rawGap);
  const isShortfall = rawGap < 0;

  const accountsByBucket = useMemo(() => {
    const out = { taxAdvantaged: [] as Account[], brokerage: [] as Account[], cash: [] as Account[] };
    for (const a of accounts) {
      if (a.excludedFromNetWorth) continue;
      const bucket = taxBucketForAccount(a);
      if (bucket === 'taxAdvantaged') out.taxAdvantaged.push(a);
      else if (bucket === 'taxable') out.brokerage.push(a);
    }
    return out;
  }, [accounts]);

  const updateGapAllocation = async (next: GapAllocation) => {
    if (!active?.id) return;
    await useScenariosStore.getState().updateLever(active.id, { gapAllocation: next });
  };

  const updatePlan = (patch: Partial<PersonIncomePlan>) => {
    setDraft((d) => d.map((p, i) => (i === tab ? { ...p, ...patch } : p)));
  };

  const updateEvent = (idx: number, patch: Partial<IncomeEvent>) => {
    setDraft((d) => d.map((p, pIdx) => {
      if (pIdx !== tab) return p;
      const next = [...p.events];
      next[idx] = { ...(next[idx] as unknown as Record<string, unknown>), ...patch } as IncomeEvent;
      return { ...p, events: next };
    }));
  };

  const setEventType = (idx: number, newType: EventType) => {
    setDraft((d) => d.map((p, pIdx) => {
      if (pIdx !== tab) return p;
      const next = [...p.events];
      const cur = next[idx];
      let replaced: IncomeEvent;
      switch (newType) {
        case 'raise':
          replaced = { when: cur.when, type: 'raise', deltaAmount: 0 };
          break;
        case 'promotion':
        case 'cut':
        case 'job_change':
          replaced = { when: cur.when, type: newType, newSalary: personSalary };
          break;
        case 'sabbatical':
          replaced = { when: cur.when, type: 'sabbatical', durationMonths: 6 };
          break;
      }
      next[idx] = replaced;
      return { ...p, events: next };
    }));
  };

  const addEvent = () => updatePlan({ events: [...plan.events, emptyEvent()] });
  const removeEvent = (idx: number) => updatePlan({ events: plan.events.filter((_, i) => i !== idx) });

  const mirrorToOther = () => {
    if (personCount !== 2) return;
    const other = tab === 0 ? 1 : 0;
    setDraft((d) => d.map((p, i) => (i === other ? plan : p)));
  };

  const handleApply = async () => {
    if (!active?.id) return;
    await useScenariosStore.getState().updateLever(active.id, { income: { perPerson: draft } });
    onOpenChange(false);
  };

  const handleReset = () => {
    setDraft(Array.from({ length: personCount }, (_, i) =>
      active?.leverPayload.income.perPerson[i] ?? defaultPersonPlan(),
    ));
  };

  const trajectoryYears = Math.max(5, Math.min(20, Math.round(horizonMonths / 12)));
  const trajectory = incomeTrajectory({
    baseSalary: personSalary,
    plan,
    startYear: new Date().getFullYear(),
    years: trajectoryYears,
  });

  return (
    <LeverPopoverShell open={open} title="Income / raises" onOpenChange={onOpenChange} onApply={handleApply} onReset={handleReset}>
      <div className="space-y-3">
        {/* Per-person summary (revamp 2026-05-26): one card per person showing
            annual salary, monthly pre-tax, monthly after-tax. */}
        <div className="space-y-2">
          {labels.map((lbl, i) => {
            const annualSalary = persons[i]?.annualSalaryPretax ?? 0;
            const monthlyPretax = annualSalary / 12;
            const monthlyAfterTax = perPersonAfterTaxMonthly[i] ?? 0;
            return (
              <div key={lbl} data-testid={`income-person-summary-${i}`} className="rounded-md border px-3 py-2 text-sm">
                <div className="font-medium">{lbl}</div>
                <div className="grid grid-cols-2 gap-x-3 text-xs tabular-nums">
                  <span>Annual salary (pre-tax):</span><span>{formatCurrency(annualSalary)}</span>
                  <span>Monthly:</span>
                  <span>
                    {formatCurrency(monthlyPretax)} pre-tax · {' '}
                    <span data-testid={`income-after-tax-monthly-${i}`}>{formatCurrency(monthlyAfterTax)}</span> after-tax
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Household total — only when 2 persons */}
        {personCount === 2 && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">Household total</span>{' — '}
            <span>After-tax monthly: </span>
            <span data-testid="income-household-after-tax-monthly" className="font-mono tabular-nums">
              {formatCurrency(householdAfterTaxMonthly)}
            </span>
          </div>
        )}

        {/* Monthly cash-flow summary */}
        <div className="rounded-md border px-3 py-2 text-sm">
          <div className="font-medium text-xs uppercase tracking-wider text-muted-foreground">Monthly cash flow</div>
          <div className="grid grid-cols-2 gap-x-3 text-xs tabular-nums">
            <span>After-tax income:</span><span>{formatCurrency(householdAfterTaxMonthly)}</span>
            <span>Expenses:</span><span>−{formatCurrency(currentExpensesMonthly)}</span>
            <span>Loan payments:</span><span>−{formatCurrency(currentLoansMonthly)}</span>
            <span className="font-medium border-t pt-1">{isShortfall ? 'Shortfall:' : 'Surplus (gap):'}</span>
            <span data-testid="income-monthly-gap" className="font-medium border-t pt-1">
              {isShortfall ? '−' : ''}{formatCurrency(Math.abs(rawGap))} / mo
            </span>
          </div>
        </div>

        {/* Allocation editor — hidden when shortfall (no surplus to allocate) */}
        {!isShortfall && (
          <GapAllocationEditor
            gap={gap}
            gapAllocation={active?.leverPayload.gapAllocation ?? { taxAdvantaged: null, brokerage: null }}
            accountsByBucket={accountsByBucket}
            onChange={updateGapAllocation}
          />
        )}

        {personCount === 2 && (
          <div role="tablist" className="flex gap-1 border-b">
            {labels.map((lbl, i) => (
              <Button
                key={lbl}
                role="tab"
                aria-selected={tab === i}
                size="sm"
                variant={tab === i ? 'default' : 'ghost'}
                onClick={() => setTab(i)}
                aria-label={lbl.toLowerCase()}
              >
                {lbl}
              </Button>
            ))}
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={mirrorToOther} aria-label={`Mirror to ${tab === 0 ? 'Partner' : 'You'}`}>
              Mirror to {tab === 0 ? 'Partner' : 'You'}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="raise-rate" className="text-xs">Annual raise rate (%)</Label>
            <Input
              id="raise-rate"
              type="number"
              step={0.25}
              min={-5}
              max={15}
              value={(plan.annualRaiseRate * 100).toFixed(2)}
              onChange={(e) => {
                const n = Number(e.target.value);
                updatePlan({ annualRaiseRate: Number.isFinite(n) ? n / 100 : 0 });
              }}
              aria-label="Annual raise rate"
            />
          </div>
          <div className="text-sm text-muted-foreground self-end">
            Current salary: {formatCurrency(personSalary)}
          </div>
        </div>

        <div className="space-y-2">
          {plan.events.map((ev, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end border-b py-2">
              <div>
                <Label htmlFor={`ev-when-${i}`} className="text-xs">When (YYYY-MM-DD)</Label>
                <Input id={`ev-when-${i}`} value={ev.when} onChange={(e) => updateEvent(i, { when: e.target.value })} aria-label="When" />
              </div>
              <div>
                <Label htmlFor={`ev-type-${i}`} className="text-xs">Type</Label>
                <select
                  id={`ev-type-${i}`}
                  className="border rounded h-9 px-2 w-full text-sm bg-background"
                  value={ev.type}
                  onChange={(e) => setEventType(i, e.target.value as EventType)}
                  aria-label="Type"
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              {ev.type === 'raise' && (
                <div>
                  <Label htmlFor={`ev-delta-${i}`} className="text-xs">Delta amount</Label>
                  <Input
                    id={`ev-delta-${i}`}
                    type="number"
                    step={500}
                    value={(ev as { deltaAmount?: number }).deltaAmount ?? 0}
                    onChange={(e) => updateEvent(i, { deltaAmount: Number(e.target.value) || 0 } as Partial<IncomeEvent>)}
                    aria-label="Delta amount"
                  />
                </div>
              )}
              {(ev.type === 'promotion' || ev.type === 'cut' || ev.type === 'job_change') && (
                <div>
                  <Label htmlFor={`ev-newsal-${i}`} className="text-xs">New salary</Label>
                  <Input
                    id={`ev-newsal-${i}`}
                    type="number"
                    step={1000}
                    value={(ev as { newSalary?: number }).newSalary ?? 0}
                    onChange={(e) => updateEvent(i, { newSalary: Number(e.target.value) || 0 } as Partial<IncomeEvent>)}
                    aria-label="New salary"
                  />
                </div>
              )}
              {ev.type === 'sabbatical' && (
                <div>
                  <Label htmlFor={`ev-dur-${i}`} className="text-xs">Duration (months)</Label>
                  <Input
                    id={`ev-dur-${i}`}
                    type="number"
                    min={1}
                    step={1}
                    value={(ev as { durationMonths?: number }).durationMonths ?? 6}
                    onChange={(e) => updateEvent(i, { durationMonths: Math.max(1, Math.floor(Number(e.target.value) || 1)) } as Partial<IncomeEvent>)}
                    aria-label="Duration (months)"
                  />
                </div>
              )}
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => removeEvent(i)} aria-label={`Remove event ${i + 1}`}>Remove</Button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addEvent} aria-label="Add income event">+ Add income event</Button>
        </div>

        <div className="pt-3 border-t" data-testid="income-trajectory-preview">
          <div className="text-xs font-medium mb-1 text-muted-foreground">Salary trajectory ({trajectory[0]?.year} – {trajectory[trajectory.length - 1]?.year})</div>
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-xs">
            {trajectory.map((p) => (
              <li key={p.year} className="tabular-nums">
                <span className="text-muted-foreground">{p.year}:</span> {formatCurrency(p.salary)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </LeverPopoverShell>
  );
}
