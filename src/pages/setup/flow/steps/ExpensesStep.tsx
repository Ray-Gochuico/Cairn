import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { saveExpenses } from '@/domain/setup-flow/steps/part1';
import { isSetupDismissed } from '@/lib/setup-dismissal';
import type { StepComponentProps } from '../step-props';

/** 1e — CW-22. Skippable; an empty value writes NOTHING (D-WF18). The shell
 *  renders the CW-7 skip control + CW-23 consequence. */
export default function ExpensesStep({ ctx, asked, onDirtyChange, submitRef }: StepComponentProps) {
  // Review M5 (D-W4): post-finish, Revisit setup prefills the household cells.
  const [seed] = useState<number | null>(() =>
    (asked || isSetupDismissed()) && ctx.household
      ? ctx.household.monthlyExpenseBaseline || null
      : null,
  );
  const [monthly, setMonthly] = useState<number | null>(seed);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    onDirtyChange(monthly !== seed);
  }, [monthly, seed, onDirtyChange]);

  useEffect(() => {
    submitRef.current = async () => {
      try {
        setSaveError(false);
        return await saveExpenses({ monthly }, ctx);
      } catch {
        setSaveError(true);
        return { ok: false };
      }
    };
  });

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="flow-expenses">About how much does your household spend in a month?</Label>
        <MoneyInput
          id="flow-expenses"
          value={monthly}
          onValueChange={setMonthly}
          aria-describedby="flow-expenses-basis"
        />
        <p id="flow-expenses-basis" className="text-sm text-muted-foreground mt-1">
          We'll use this as your monthly budget on Spending, your expense assumption for FI
          and projections, and your emergency-fund target until 12 months of transactions
          exist.
        </p>
      </div>
      {saveError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive-soft-foreground"
        >
          Couldn't save — please check the values.
        </div>
      )}
    </div>
  );
}
